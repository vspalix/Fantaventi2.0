import { awardBadges, bonusWeight, h2hFlips, heavyMalus, overtakes, pitchEvents } from "@/lib/engagement/live-board";
import { parseLeagueRules, weekScoreMode } from "@/lib/league-rules";
import { writeLeagueFeed } from "@/lib/server/league-feed";
import { overlayPublishedVotes } from "@/lib/server/live-projection";
import { previewProvisional } from "@/lib/server/live-score";
import { sendPushToUsers } from "@/lib/server/web-push";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

type Template = { title: string; body: string; enabled: boolean };

const DEFAULT_TEMPLATES: Record<string, Template> = {
  deadline: {
    title: "Chiudi la formazione",
    body: "Mancano 30 minuti alla giornata {matchday}. Se non la invii, resta l'ultima schierata.",
    enabled: true,
  },
  bonus: { title: "Bonus in campo", body: "{player}: {event}.", enabled: true },
  overtake: { title: "Sorpasso live", body: "{opponent} ti ha superato. Giornata {matchday}.", enabled: true },
};

function missingSchema(message: string) {
  return /schema cache|could not find|relation|does not exist/i.test(message);
}

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

async function claim(key: string) {
  const admin = createAdminSupabase();
  const inserted = await admin.from("engagement_notices").insert({ dedupe_key: key });
  if (!inserted.error) return true;
  if (missingSchema(inserted.error.message) || /duplicate|23505/i.test(inserted.error.message)) return false;
  throw new Error(inserted.error.message);
}

async function templates() {
  const admin = createAdminSupabase();
  const rows = await admin.from("notification_templates").select("kind, title, body, enabled");
  if (rows.error) return DEFAULT_TEMPLATES;
  const map = { ...DEFAULT_TEMPLATES };
  for (const row of rows.data ?? []) {
    map[row.kind as string] = {
      title: row.title as string,
      body: row.body as string,
      enabled: Boolean(row.enabled),
    };
  }
  return map;
}

export async function runEngagementTick(now = new Date()) {
  const texts = await templates();
  const deadline = await warnDeadlines(now, texts.deadline);
  const bonuses = await notifyBonuses(texts.bonus);
  const passes = await notifyOvertakes(texts.overtake);
  const badges = await awardLatestBadges();
  return { sent: deadline + bonuses + passes, badges };
}

async function warnDeadlines(now: Date, template: Template) {
  if (!template.enabled) return 0;
  const admin = createAdminSupabase();
  const until = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const weeks = await admin
    .from("gameweeks")
    .select("id, number, season_id, deadline_at")
    .eq("status", "open")
    .gt("deadline_at", now.toISOString())
    .lte("deadline_at", until);
  if (weeks.error) return 0;
  let sent = 0;
  for (const week of weeks.data ?? []) {
    const teams = await admin.from("fantasy_teams").select("id, user_id").eq("season_id", week.season_id as string);
    if (teams.error) continue;
    const teamIds = (teams.data ?? []).map((row) => row.id as string);
    if (teamIds.length === 0) continue;
    const filed = await admin.from("lineups").select("fantasy_team_id").eq("gameweek_id", week.id as string).in("fantasy_team_id", teamIds);
    if (filed.error) continue;
    const ready = new Set((filed.data ?? []).map((row) => row.fantasy_team_id as string));
    const pending = (teams.data ?? []).filter((row) => !ready.has(row.id as string));
    const userIds: string[] = [];
    for (const team of pending) {
      const userId = team.user_id as string;
      if (await claim(`deadline:${week.id as string}:${userId}`)) userIds.push(userId);
    }
    if (userIds.length === 0) continue;
    const result = await sendPushToUsers([...new Set(userIds)], {
      title: fill(template.title, { matchday: String(week.number) }),
      body: fill(template.body, { matchday: String(week.number) }),
      url: "/leghe",
    });
    sent += result.sent;
  }
  return sent;
}

async function notifyBonuses(template: Template) {
  if (!template.enabled) return 0;
  const admin = createAdminSupabase();
  const weeks = await admin.from("gameweeks").select("id, number, season_id, status").in("status", ["open", "locked"]).limit(4);
  if (weeks.error) return 0;
  let sent = 0;
  for (const week of weeks.data ?? []) {
    const season = await admin.from("seasons").select("code").eq("id", week.season_id as string).maybeSingle();
    if (season.error || !season.data) continue;
    let preview: Awaited<ReturnType<typeof previewProvisional>>;
    try {
      preview = await previewProvisional(week.id as string);
    } catch {
      continue;
    }
    const roles = new Map<string, PlayerRole>();
    for (const lineup of preview.lineups) {
      for (const slot of lineup.slots) if (slot.role) roles.set(slot.playerId, slot.role);
    }
    const stats = await overlayPublishedVotes(preview.stats, season.data.code as string, Number(week.number), roles);
    const teamIds = preview.lineups.map((lineup) => lineup.fantasyTeamId);
    const owners = teamIds.length
      ? await admin.from("fantasy_teams").select("id, user_id").in("id", teamIds)
      : { data: [], error: null };
    const ownerOf = new Map((owners.data ?? []).map((row) => [row.id as string, row.user_id as string]));
    const playerIds = [...new Set(preview.lineups.flatMap((lineup) => lineup.slots.map((slot) => slot.playerId)))];
    const people = playerIds.length
      ? await admin.from("players").select("id, full_name").in("id", playerIds)
      : { data: [], error: null };
    const playerName = new Map((people.data ?? []).map((row) => [row.id as string, row.full_name as string]));
    for (const lineup of preview.lineups) {
      const events = pitchEvents(lineup.slots.filter((slot) => slot.benchOrder == null).map((slot) => ({
        playerId: slot.playerId,
        playerName: playerName.get(slot.playerId) ?? "Calciatore",
        teamName: "",
        stat: stats.get(slot.playerId) ?? { playerId: slot.playerId, role: "MID" as const, voto: null },
      }))).filter((event) => /gol|assist|rigore parato/.test(event.label));
      const userId = ownerOf.get(lineup.fantasyTeamId);
      if (!userId) continue;
      for (const event of events) {
        if (!(await claim(`bonus:${week.id as string}:${lineup.fantasyTeamId}:${event.playerId}:${event.label}`))) continue;
        const result = await sendPushToUsers([userId], {
          title: fill(template.title, { player: event.playerName, event: event.label, matchday: String(week.number) }),
          body: fill(template.body, { player: event.playerName, event: event.label, matchday: String(week.number) }),
          url: "/leghe",
        });
        sent += result.sent;
      }
    }
  }
  return sent;
}

async function notifyOvertakes(template: Template) {
  if (!template.enabled) return 0;
  const admin = createAdminSupabase();
  const leagues = await admin.from("private_leagues").select("id, season_id, settings");
  if (leagues.error) return 0;
  let sent = 0;
  for (const league of leagues.data ?? []) {
    const rules = parseLeagueRules(league.settings);
    const week = await admin
      .from("gameweeks")
      .select("id, number, status")
      .eq("season_id", league.season_id as string)
      .in("status", ["open", "locked"])
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (week.error || !week.data) continue;
    const currentWeek = week.data;
    const members = await admin.from("private_league_members").select("fantasy_team_id").eq("private_league_id", league.id as string);
    if (members.error) continue;
    const teamIds = (members.data ?? []).map((row) => row.fantasy_team_id as string);
    if (teamIds.length < 2) continue;
    const scores = await admin
      .from("team_gameweek_scores")
      .select("fantasy_team_id, provisional_total, is_live")
      .eq("gameweek_id", currentWeek.id as string)
      .in("fantasy_team_id", teamIds);
    if (scores.error) continue;
    const live = new Map((scores.data ?? []).filter((row) => row.is_live).map((row) => [row.fantasy_team_id as string, Number(row.provisional_total ?? 0)]));
    if (live.size < 2) continue;
    const after = teamIds.map((teamId) => ({ teamId, points: live.get(teamId) ?? 0 }));
    const previous = await admin
      .from("live_rank_snapshots")
      .select("fantasy_team_id, points")
      .eq("league_id", league.id as string)
      .eq("gameweek_id", currentWeek.id as string);
    if (previous.error) continue;
    const before = (previous.data ?? []).map((row) => ({ teamId: row.fantasy_team_id as string, points: Number(row.points) }));
    const names = await admin.from("fantasy_teams").select("id, user_id, name").in("id", teamIds);
    const teamName = new Map((names.data ?? []).map((row) => [row.id as string, row.name as string]));
    const userOf = new Map((names.data ?? []).map((row) => [row.id as string, row.user_id as string]));
    if (before.length > 0) {
      const mode = weekScoreMode(rules, Number(currentWeek.number));
      const moves = overtakes(before, after);
      const flips = mode === "sum"
        ? []
        : h2hFlips(teamIds, Number(currentWeek.number), new Map(before.map((row) => [row.teamId, row.points])), new Map(after.map((row) => [row.teamId, row.points])), rules.goalBands);
      for (const move of moves) {
        if (!(await claim(`overtake:${league.id as string}:${currentWeek.id as string}:${move.teamId}:${move.byTeamId}`))) continue;
        const opponent = teamName.get(move.byTeamId) ?? "Un avversario";
        const userId = userOf.get(move.teamId);
        if (!userId) continue;
        const result = await sendPushToUsers([userId], {
          title: fill(template.title, { opponent, matchday: String(currentWeek.number) }),
          body: fill(template.body, { opponent, matchday: String(currentWeek.number) }),
          url: "/leghe",
        });
        sent += result.sent;
        await writeLeagueFeed({
          leagueId: league.id as string,
          gameweekId: currentWeek.id as string,
          kind: "ribaltone",
          body: `${opponent} supera ${teamName.get(move.teamId) ?? "una squadra"} nella live della giornata ${currentWeek.number as number}.`,
        });
      }
      for (const flip of flips) {
        if (!(await claim(`flip:${league.id as string}:${currentWeek.id as string}:${flip.loser}:${flip.winner}`))) continue;
        const opponent = teamName.get(flip.winner) ?? "L'avversario";
        const userId = userOf.get(flip.loser);
        if (userId) {
          const result = await sendPushToUsers([userId], {
            title: fill(template.title, { opponent, matchday: String(currentWeek.number) }),
            body: `${opponent} ribalta lo scontro diretto.`,
            url: "/leghe",
          });
          sent += result.sent;
        }
        await writeLeagueFeed({
          leagueId: league.id as string,
          gameweekId: currentWeek.id as string,
          kind: "ribaltone",
          body: `${opponent} ribalta lo scontro con ${teamName.get(flip.loser) ?? "l'avversario"}.`,
        });
      }
    }
    await admin.from("live_rank_snapshots").upsert(after.map((row) => ({
      league_id: league.id as string,
      gameweek_id: currentWeek.id as string,
      fantasy_team_id: row.teamId,
      points: row.points,
    })), { onConflict: "league_id,gameweek_id,fantasy_team_id" });
  }
  return sent;
}

async function awardLatestBadges() {
  const admin = createAdminSupabase();
  const weeks = await admin
    .from("gameweeks")
    .select("id, number, season_id, status")
    .in("status", ["scored", "final"])
    .order("number", { ascending: false })
    .limit(8);
  if (weeks.error) return 0;
  let awarded = 0;
  const seen = new Set<string>();
  for (const week of weeks.data ?? []) {
    const seasonId = week.season_id as string;
    if (seen.has(seasonId)) continue;
    seen.add(seasonId);
    const leagues = await admin.from("private_leagues").select("id, name, settings").eq("season_id", seasonId);
    if (leagues.error) continue;
    for (const league of leagues.data ?? []) {
      const existing = await admin
        .from("league_badges")
        .select("id")
        .eq("league_id", league.id as string)
        .eq("gameweek_id", week.id as string)
        .limit(1);
      if (existing.error || (existing.data ?? []).length > 0) continue;
      const count = await awardLeagueWeek(league.id as string, week.id as string, Number(week.number));
      awarded += count;
    }
  }
  return awarded;
}

async function awardLeagueWeek(leagueId: string, gameweekId: string, gameweekNumber: number) {
  const admin = createAdminSupabase();
  const members = await admin.from("private_league_members").select("fantasy_team_id").eq("private_league_id", leagueId);
  if (members.error) return 0;
  const teamIds = (members.data ?? []).map((row) => row.fantasy_team_id as string);
  if (teamIds.length === 0) return 0;
  const teams = await admin.from("fantasy_teams").select("id, name").in("id", teamIds);
  const teamName = new Map((teams.data ?? []).map((row) => [row.id as string, row.name as string]));
  const lineups = await admin.from("lineups").select("id, fantasy_team_id").eq("gameweek_id", gameweekId).in("fantasy_team_id", teamIds);
  if (lineups.error || (lineups.data ?? []).length === 0) return 0;
  const lineupIds = (lineups.data ?? []).map((row) => row.id as string);
  const slots = await admin.from("lineup_slots").select("lineup_id, player_id, is_starter").in("lineup_id", lineupIds);
  if (slots.error) return 0;
  const stats = await admin
    .from("player_gameweek_stats")
    .select("player_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals")
    .eq("gameweek_id", gameweekId);
  if (stats.error) return 0;
  const statOf = new Map((stats.data ?? []).map((row) => [row.player_id as string, {
    playerId: row.player_id as string,
    role: "MID" as const,
    voto: row.voto == null ? null : Number(row.voto),
    goals: Number(row.goals ?? 0),
    assists: Number(row.assists ?? 0),
    yellowCards: Number(row.yellow_cards ?? 0),
    redCards: Number(row.red_cards ?? 0),
    penaltiesScored: Number(row.penalties_scored ?? 0),
    penaltiesMissed: Number(row.penalties_missed ?? 0),
    penaltiesSaved: Number(row.penalties_saved ?? 0),
    ownGoals: Number(row.own_goals ?? 0),
  }]));
  const slotsByLineup = new Map<string, { playerId: string; starter: boolean }[]>();
  for (const slot of slots.data ?? []) {
    const list = slotsByLineup.get(slot.lineup_id as string) ?? [];
    list.push({ playerId: slot.player_id as string, starter: slot.is_starter !== false });
    slotsByLineup.set(slot.lineup_id as string, list);
  }
  const rows = (lineups.data ?? []).map((lineup) => {
    const picked = slotsByLineup.get(lineup.id as string) ?? [];
    let benchBonus = 0;
    let bonus = 0;
    let heavy = 0;
    for (const slot of picked) {
      const stat = statOf.get(slot.playerId);
      if (!stat || stat.voto == null) continue;
      if (slot.starter) {
        bonus += bonusWeight(stat);
        heavy += heavyMalus(stat);
      } else {
        benchBonus += bonusWeight(stat);
      }
    }
    return {
      teamId: lineup.fantasy_team_id as string,
      teamName: teamName.get(lineup.fantasy_team_id as string) ?? "Squadra",
      benchBonus,
      bonus,
      heavy,
    };
  });
  const awards = awardBadges(rows);
  if (awards.length === 0) return 0;
  const saved = await admin.from("league_badges").upsert(awards.map((award) => ({
    league_id: leagueId,
    gameweek_id: gameweekId,
    fantasy_team_id: award.teamId,
    kind: award.kind,
    title: award.title,
    detail: award.detail,
  })), { onConflict: "league_id,gameweek_id,kind" });
  if (saved.error) return 0;
  const bars = rows
    .map((row) => ({ name: row.teamName, points: row.bonus }))
    .sort((left, right) => right.points - left.points);
  await writeLeagueFeed({
    leagueId,
    gameweekId,
    kind: "risultati",
    body: `Giornata ${gameweekNumber} chiusa. In bacheca ci sono le pagelle della settimana.`,
    payload: { bars },
  });
  for (const award of awards) {
    await writeLeagueFeed({
      leagueId,
      gameweekId,
      kind: "badge",
      body: `${award.title}: ${award.detail}`,
      payload: { kind: award.kind },
    });
  }
  return awards.length;
}

export async function rebuildWeekBoard(gameweekId: string) {
  const admin = createAdminSupabase();
  const week = await admin.from("gameweeks").select("id, number, season_id").eq("id", gameweekId).maybeSingle();
  if (week.error || !week.data) return 0;
  const clearedBadges = await admin.from("league_badges").delete().eq("gameweek_id", gameweekId);
  if (clearedBadges.error && !/league_badges|schema cache|could not find/i.test(clearedBadges.error.message)) {
    throw new Error(clearedBadges.error.message);
  }
  const clearedFeed = await admin
    .from("league_feed")
    .delete()
    .eq("gameweek_id", gameweekId)
    .in("kind", ["risultati", "badge", "ribaltone"]);
  if (clearedFeed.error && !/league_feed|schema cache|could not find/i.test(clearedFeed.error.message)) {
    throw new Error(clearedFeed.error.message);
  }
  const leagues = await admin.from("private_leagues").select("id").eq("season_id", week.data.season_id);
  if (leagues.error) return 0;
  let rebuilt = 0;
  for (const league of leagues.data ?? []) {
    rebuilt += await awardLeagueWeek(league.id as string, gameweekId, Number(week.data.number));
  }
  return rebuilt;
}
