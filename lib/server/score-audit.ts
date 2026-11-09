import { explainScore, type ScoreAudit } from "@/lib/engine/score-audit";
import { weekScoreMode } from "@/lib/league-rules";
import { projectLiveScore, scoreLineup, type LineupSlotInput, type PlayerStat, type RulesetDefinition } from "@/lib/engine/calculator";
import { overlayPublishedVotes } from "@/lib/server/live-projection";
import type { PlayerRole } from "@/lib/types";
import { getLeagueDetail } from "@/lib/server/leagues";
import { definitionForLeague } from "@/lib/server/league-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

type SlotRow = {
  lineup_id?: string;
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
  is_starter?: boolean;
  slot_order?: number;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function loadScoreAudit(
  userId: string,
  leagueId: string,
  gameweekId: string,
  fantasyTeamId: string,
  access: "owner" | "member" = "owner",
): Promise<ScoreAudit> {
  const league = await getLeagueDetail(userId, leagueId);
  if (access === "owner" && !league.isManager && !league.platformOverride) {
    throw httpError("L'audit è riservato all'admin della lega.", 403);
  }
  const namesByTeam = new Map(league.participants.map((team) => [team.fantasyTeamId, team.teamName]));
  if (!namesByTeam.has(fantasyTeamId)) throw httpError("Squadra non trovata in questa lega.", 404);

  const admin = createAdminSupabase();
  const week = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .eq("id", gameweekId)
    .eq("season_id", league.seasonId)
    .maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) throw httpError("Giornata non trovata in questa stagione.", 404);
  const gameweekNumber = week.data.number as number;
  const official = week.data.status === "scored" || week.data.status === "final";
  if (access === "member" && !official) {
    throw httpError("Il dettaglio si apre quando la giornata è calcolata.", 409);
  }

  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("rulesets(definition)")
    .eq("id", league.seasonId)
    .single();
  if (seasonError) throw new Error(seasonError.message);
  const ruleset = one(season.rulesets as { definition?: RulesetDefinition } | { definition?: RulesetDefinition }[] | null);
  const { rules, definition } = await definitionForLeague(admin, leagueId, (ruleset?.definition ?? {}) as RulesetDefinition);

  const teamIds = [...namesByTeam.keys()];
  const { data: lineupRows, error: lineupError } = await admin
    .from("lineups")
    .select("id, fantasy_team_id")
    .eq("gameweek_id", gameweekId)
    .in("fantasy_team_id", teamIds);
  if (lineupError) throw new Error(lineupError.message);
  const lineupIds = (lineupRows ?? []).map((row) => row.id as string);
  const extended = lineupIds.length
    ? await admin.from("lineup_slots").select("lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order").in("lineup_id", lineupIds)
    : { data: [] as SlotRow[], error: null };
  const slotsQuery = extended.error && /is_starter|slot_order/i.test(extended.error.message)
    ? await admin.from("lineup_slots").select("lineup_id, player_id, is_captain, is_vice_captain").in("lineup_id", lineupIds)
    : extended;
  if (slotsQuery.error) throw new Error(slotsQuery.error.message);

  const slotsByLineup = new Map<string, SlotRow[]>();
  for (const slot of (slotsQuery.data ?? []) as SlotRow[]) {
    const list = slotsByLineup.get(slot.lineup_id ?? "") ?? [];
    list.push(slot);
    slotsByLineup.set(slot.lineup_id ?? "", list);
  }

  const { data: registrations, error: registrationError } = await admin
    .from("player_registrations")
    .select("player_id, club_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", league.seasonId);
  if (registrationError) throw new Error(registrationError.message);
  const roles = new Map<string, PlayerRole>();
  const clubs = new Map<string, string>();
  for (const row of registrations ?? []) {
    const from = row.effective_from_gameweek as number;
    const until = row.effective_to_gameweek as number | null;
    if (from > gameweekNumber || (until !== null && until < gameweekNumber)) continue;
    roles.set(row.player_id as string, row.role as PlayerRole);
    clubs.set(row.player_id as string, row.club_id as string);
  }

  const statSelect = "player_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals, goals_conceded, postponed";
  const statsQuery = await admin.from("player_gameweek_stats").select(statSelect).eq("gameweek_id", gameweekId);
  const plainStats = statsQuery.error && /postponed/i.test(statsQuery.error.message)
    ? await admin.from("player_gameweek_stats").select(statSelect.replace(", postponed", "")).eq("gameweek_id", gameweekId)
    : statsQuery;
  if (plainStats.error) throw new Error(plainStats.error.message);

  type StatRow = {
    player_id: string;
    voto: number | string | null;
    goals: number | null;
    assists: number | null;
    yellow_cards: number | null;
    red_cards: number | null;
    penalties_scored: number | null;
    penalties_missed: number | null;
    penalties_saved: number | null;
    own_goals: number | null;
    goals_conceded: number | null;
    postponed?: boolean | null;
  };
  const stats = new Map<string, PlayerStat>();
  for (const row of (plainStats.data ?? []) as StatRow[]) {
    const playerId = row.player_id;
    const postponed = Boolean(row.postponed);
    stats.set(playerId, {
      playerId,
      role: roles.get(playerId) ?? "MID",
      voto: row.voto == null ? null : Number(row.voto),
      goals: Number(row.goals ?? 0),
      assists: Number(row.assists ?? 0),
      yellowCards: Number(row.yellow_cards ?? 0),
      redCards: Number(row.red_cards ?? 0),
      penaltiesScored: Number(row.penalties_scored ?? 0),
      penaltiesMissed: Number(row.penalties_missed ?? 0),
      penaltiesSaved: Number(row.penalties_saved ?? 0),
      ownGoals: Number(row.own_goals ?? 0),
      goalsConceded: Number(row.goals_conceded ?? 0),
      postponed,
    });
  }

  const matches = await admin.from("real_matches").select("home_club_id, away_club_id, status").eq("gameweek_id", gameweekId);
  const finishedClubs = new Set<string>();
  if (!matches.error) {
    for (const match of matches.data ?? []) {
      if (match.status !== "finished") continue;
      finishedClubs.add(match.home_club_id as string);
      finishedClubs.add(match.away_club_id as string);
    }
  }
  const matchFinished = new Set<string>();
  for (const [playerId, clubId] of clubs) {
    if (finishedClubs.has(clubId)) matchFinished.add(playerId);
  }

  let auditStats = stats;
  if (!official) {
    const seasonCode = await admin.from("seasons").select("code").eq("id", league.seasonId).maybeSingle();
    if (!seasonCode.error && seasonCode.data?.code) {
      auditStats = await overlayPublishedVotes(stats, String(seasonCode.data.code), gameweekNumber, roles);
    }
  }

  const slotsOf = (lineupId: string): LineupSlotInput[] => (slotsByLineup.get(lineupId) ?? []).map((slot) => ({
    playerId: slot.player_id,
    isCaptain: Boolean(slot.is_captain) && slot.is_starter !== false,
    isVice: Boolean(slot.is_vice_captain) && slot.is_starter !== false,
    role: roles.get(slot.player_id),
    benchOrder: slot.is_starter === false ? Number(slot.slot_order ?? 0) : undefined,
  }));

  const lineupByTeam = new Map((lineupRows ?? []).map((row) => [row.fantasy_team_id as string, row.id as string]));
  if (!lineupByTeam.has(fantasyTeamId)) throw httpError("Questa squadra non ha una formazione per la giornata.", 404);

  const mode = official ? "official" as const : "provisional" as const;
  const totalOf = (teamId: string) => {
    const lineupId = lineupByTeam.get(teamId);
    if (!lineupId) return 0;
    const slots = slotsOf(lineupId);
    const score = mode === "provisional"
      ? projectLiveScore(teamId, gameweekId, slots, auditStats, definition)
      : scoreLineup(teamId, slots, stats, definition);
    return score.total;
  };
  const totals = teamIds.map((teamId) => ({
    fantasyTeamId: teamId,
    teamName: namesByTeam.get(teamId) ?? "Squadra",
    total: totalOf(teamId),
  }));

  const stored = await admin
    .from("team_gameweek_scores")
    .select("total, provisional_total, is_live")
    .eq("gameweek_id", gameweekId)
    .eq("fantasy_team_id", fantasyTeamId)
    .maybeSingle();
  const storedRow = stored.error && /provisional_total|is_live/i.test(stored.error.message)
    ? await admin.from("team_gameweek_scores").select("total").eq("gameweek_id", gameweekId).eq("fantasy_team_id", fantasyTeamId).maybeSingle()
    : stored;
  const saved = storedRow.data as { total?: number | string | null; provisional_total?: number | string | null; is_live?: boolean } | null;
  const savedNumber = official
    ? saved?.total
    : saved?.is_live ? saved.provisional_total : null;
  const storedTotal = savedNumber == null || !Number.isFinite(Number(savedNumber)) ? null : Number(savedNumber);

  const playerIds = slotsOf(lineupByTeam.get(fantasyTeamId) ?? "").map((slot) => slot.playerId);
  const listed = playerIds.length
    ? await admin.from("players").select("id, full_name").in("id", playerIds)
    : { data: [], error: null };
  if (listed.error) throw new Error(listed.error.message);
  const names = new Map((listed.data ?? []).map((row) => [row.id as string, row.full_name as string]));

  return explainScore({
    fantasyTeamId,
    teamName: namesByTeam.get(fantasyTeamId) ?? "Squadra",
    gameweekNumber,
    slots: slotsOf(lineupByTeam.get(fantasyTeamId) ?? ""),
    stats: mode === "provisional" ? auditStats : stats,
    definition,
    names,
    mode,
    matchFinished,
    ranking: weekScoreMode(rules, gameweekNumber) === "sum" ? "sum" : "head_to_head",
    goalBands: weekScoreMode(rules, gameweekNumber) === "sum" ? [] : rules.goalBands,
    totals,
    storedTotal: storedTotal != null && Number.isFinite(storedTotal) ? storedTotal : null,
  });
}
