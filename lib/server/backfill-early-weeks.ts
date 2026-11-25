import { randomUUID } from "node:crypto";
import { evaluateRoster } from "@/lib/constraints";
import { autoLineup, formationIssue } from "@/lib/formations";
import { buildLegalRoster } from "@/lib/scenario/roster";
import { schemaHint, scoreOfficialGameweek } from "@/lib/server/live-score";
import { importPublishedWeekVotes } from "@/lib/server/sync-match-votes";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { DEFAULT_RULES, type CatalogPlayer, type ClubRef, type PlayerRole } from "@/lib/types";

const DEFAULT_FROM = 1;
const DEFAULT_TO = 9;

export type WeekBackfill = {
  number: number;
  lineupsFiled: number;
  lineupsAlreadyThere: number;
  realGrades: number;
  matches: number;
  matchesWithVotes: number;
  playersMatched: number;
  missingMatches: string[];
  scored: boolean;
  teamsScored: number;
  note: string;
};

export type BackfillReport = {
  season: string;
  leagues: string[];
  rostersCreated: string[];
  rostersKept: string[];
  rosterProblems: string[];
  weeks: WeekBackfill[];
};

function roleOf(value: string): PlayerRole {
  if (value === "GK" || value === "DEF" || value === "MID" || value === "FWD") return value;
  return "MID";
}

async function serieASeason(admin: ReturnType<typeof createAdminSupabase>) {
  const seasons = await admin.from("seasons").select("id, code, competitions!inner(code)").order("starts_on", { ascending: false });
  if (seasons.error) throw new Error(seasons.error.message);
  const season = (seasons.data ?? []).find((row) => {
    const competition = Array.isArray(row.competitions) ? row.competitions[0] : row.competitions;
    return competition?.code === "serie_a" && row.code !== "sandbox";
  });
  if (!season) throw new Error("Nessuna stagione Serie A.");
  return { id: season.id as string, code: String(season.code) };
}

async function currentLeagues(admin: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const withFlag = await admin.from("private_leagues").select("id, name, is_sandbox").eq("season_id", seasonId);
  const plain = withFlag.error && /is_sandbox|schema cache|could not find/i.test(withFlag.error.message)
    ? await admin.from("private_leagues").select("id, name").eq("season_id", seasonId)
    : withFlag;
  if (plain.error) throw new Error(plain.error.message);
  return (plain.data ?? []).flatMap((row) => {
    const sandbox = "is_sandbox" in row && row.is_sandbox === true;
    if (sandbox) return [];
    return [{ id: row.id as string, name: String(row.name) }];
  });
}

async function catalog(admin: ReturnType<typeof createAdminSupabase>, seasonId: string, fromWeek: number) {
  const regs = await admin
    .from("player_registrations")
    .select("player_id, club_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId);
  if (regs.error) throw new Error(regs.error.message);
  const current = new Map<string, { clubId: string; role: PlayerRole }>();
  for (const row of regs.data ?? []) {
    const from = Number(row.effective_from_gameweek);
    const until = row.effective_to_gameweek == null ? null : Number(row.effective_to_gameweek);
    if (from > fromWeek || (until !== null && until < fromWeek)) continue;
    current.set(row.player_id as string, { clubId: row.club_id as string, role: roleOf(String(row.role)) });
  }
  const clubIds = [...new Set([...current.values()].map((item) => item.clubId))];
  const clubsQuery = clubIds.length
    ? await admin.from("clubs").select("id, code, club_translations(locale, name, short_name)").in("id", clubIds)
    : { data: [], error: null };
  if (clubsQuery.error) throw new Error(clubsQuery.error.message);
  const clubs: ClubRef[] = (clubsQuery.data ?? []).map((club) => {
    const translations = club.club_translations as { locale: string; name: string; short_name: string }[] | { locale: string; name: string; short_name: string } | null;
    const list = translations == null ? [] : Array.isArray(translations) ? translations : [translations];
    const italian = list.find((item) => item.locale === "it") ?? list[0];
    return {
      id: club.id as string,
      code: String(club.code),
      name: italian?.name ?? String(club.code),
      shortName: italian?.short_name ?? String(club.code),
    };
  });
  const clubById = new Map(clubs.map((club) => [club.id, club]));
  const players: CatalogPlayer[] = [...current.entries()].flatMap(([playerId, item]) => {
    const club = clubById.get(item.clubId);
    if (!club) return [];
    return [{
      id: playerId,
      fullName: playerId,
      role: item.role,
      clubId: item.clubId,
      clubCode: club.code,
      clubName: club.name,
      clubShort: club.shortName,
    }];
  });
  return { players, clubs };
}

async function rosterPlayers(admin: ReturnType<typeof createAdminSupabase>, teamId: string, players: CatalogPlayer[], fromWeek: number) {
  const stints = await admin
    .from("roster_stints")
    .select("player_id, active_from_gameweek, active_until_gameweek")
    .eq("fantasy_team_id", teamId);
  if (stints.error) throw new Error(stints.error.message);
  const byId = new Map(players.map((player) => [player.id, player]));
  return (stints.data ?? []).flatMap((row) => {
    const from = Number(row.active_from_gameweek);
    const until = row.active_until_gameweek == null ? null : Number(row.active_until_gameweek);
    if (from > fromWeek || (until !== null && until < fromWeek)) return [];
    const player = byId.get(row.player_id as string);
    return player ? [player] : [];
  });
}

async function ensureRoster(
  admin: ReturnType<typeof createAdminSupabase>,
  team: { id: string; name: string },
  players: CatalogPlayer[],
  clubs: ClubRef[],
  teamIndex: number,
  fromWeek: number,
  created: string[],
  kept: string[],
  problems: string[],
) {
  const current = await rosterPlayers(admin, team.id, players, fromWeek);
  if (current.length > 0) {
    const report = evaluateRoster(current, clubs, DEFAULT_RULES);
    const lineup = autoLineup(current.map((player) => ({ id: player.id, role: player.role })));
    if (report.ready && lineup && !formationIssue(current, lineup.playerIds)) {
      kept.push(team.name);
      return current;
    }
    problems.push(`${team.name}: rosa presente ma non valida, lasciata com'è.`);
    return current;
  }
  const picked = buildLegalRoster(players, clubs, DEFAULT_RULES, teamIndex);
  const inserted = await admin.from("roster_stints").insert(picked.map((player) => ({
    id: randomUUID(),
    fantasy_team_id: team.id,
    player_id: player.id,
    active_from_gameweek: 1,
    active_until_gameweek: null,
  })));
  if (inserted.error) throw new Error(inserted.error.message);
  const validation = await admin.rpc("validate_fantasy_team_roster", {
    p_fantasy_team_id: team.id,
    p_gameweek: 1,
  });
  if (validation.error) throw new Error(validation.error.message);
  created.push(team.name);
  return picked;
}

async function fileLineup(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  roster: CatalogPlayer[],
  gameweekId: string,
) {
  const existing = await admin.from("lineups").select("id").eq("fantasy_team_id", teamId).eq("gameweek_id", gameweekId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return false;
  const picked = autoLineup(roster.map((player) => ({ id: player.id, role: player.role })));
  if (!picked) throw new Error("La rosa non basta per un modulo.");
  const issue = formationIssue(roster, picked.playerIds);
  if (issue) throw new Error(issue);
  const starters = picked.playerIds;
  const outfield = starters.filter((playerId) => roster.find((player) => player.id === playerId)?.role !== "GK");
  const captainId = outfield[0] ?? starters[0] ?? null;
  const viceId = outfield.find((playerId) => playerId !== captainId) ?? null;
  const lineupId = randomUUID();
  const saved = await admin.from("lineups").insert({
    id: lineupId,
    fantasy_team_id: teamId,
    gameweek_id: gameweekId,
    status: "locked",
    locked_at: new Date().toISOString(),
  });
  const insertError = saved.error && /locked_at|schema cache/i.test(saved.error.message)
    ? (await admin.from("lineups").insert({
      id: lineupId,
      fantasy_team_id: teamId,
      gameweek_id: gameweekId,
      status: "locked",
    })).error
    : saved.error;
  if (insertError) throw new Error(insertError.message);
  const slots = [
    ...starters.map((playerId, index) => ({
      lineup_id: lineupId,
      player_id: playerId,
      is_captain: playerId === captainId,
      is_vice_captain: playerId === viceId,
      is_starter: true,
      slot_order: index + 1,
    })),
    ...picked.benchIds.map((playerId, index) => ({
      lineup_id: lineupId,
      player_id: playerId,
      is_captain: false,
      is_vice_captain: false,
      is_starter: false,
      slot_order: index + 1,
    })),
  ];
  const slotInsert = await admin.from("lineup_slots").insert(slots);
  if (slotInsert.error) throw new Error(slotInsert.error.message);
  return true;
}

export async function backfillEarlyWeeks(fromWeek = DEFAULT_FROM, toWeek = DEFAULT_TO): Promise<BackfillReport> {
  const admin = createAdminSupabase();
  const season = await serieASeason(admin);
  const leagues = await currentLeagues(admin, season.id);
  if (leagues.length === 0) throw new Error("Nessuna lega attuale sulla Serie A.");
  const members = await admin.from("private_league_members").select("fantasy_team_id, private_league_id").in("private_league_id", leagues.map((league) => league.id));
  if (members.error) throw new Error(members.error.message);
  const teamIds = [...new Set((members.data ?? []).map((row) => row.fantasy_team_id as string))];
  const teamsQuery = teamIds.length
    ? await admin.from("fantasy_teams").select("id, name").in("id", teamIds)
    : { data: [], error: null };
  if (teamsQuery.error) throw new Error(teamsQuery.error.message);
  const teams = (teamsQuery.data ?? []).map((row) => ({ id: row.id as string, name: String(row.name) }));
  const { players, clubs } = await catalog(admin, season.id, fromWeek);
  const rostersCreated: string[] = [];
  const rostersKept: string[] = [];
  const rosterProblems: string[] = [];
  const rosters = new Map<string, CatalogPlayer[]>();
  for (const [index, team] of teams.entries()) {
    rosters.set(team.id, await ensureRoster(admin, team, players, clubs, index, fromWeek, rostersCreated, rostersKept, rosterProblems));
  }

  const weeksQuery = await admin
    .from("gameweeks")
    .select("id, number, status")
    .eq("season_id", season.id)
    .gte("number", fromWeek)
    .lte("number", toWeek)
    .order("number");
  if (weeksQuery.error) throw new Error(weeksQuery.error.message);
  const weeks: WeekBackfill[] = [];
  for (const week of weeksQuery.data ?? []) {
    const number = Number(week.number);
    const gameweekId = week.id as string;
    let lineupsFiled = 0;
    let lineupsAlreadyThere = 0;
    for (const team of teams) {
      const roster = rosters.get(team.id) ?? [];
      const existed = await admin.from("lineups").select("id").eq("fantasy_team_id", team.id).eq("gameweek_id", gameweekId).maybeSingle();
      if (existed.error) throw new Error(existed.error.message);
      if (existed.data) {
        lineupsAlreadyThere += 1;
        continue;
      }
      if (roster.length === 0) continue;
      await fileLineup(admin, team.id, roster, gameweekId);
      lineupsFiled += 1;
    }

    let realGrades = 0;
    let matches = 0;
    let matchesWithVotes = 0;
    let playersMatched = 0;
    let missingMatches: string[] = [];
    let note = "";
    try {
      const imported = await importPublishedWeekVotes(gameweekId);
      realGrades = imported.realGrades;
      matches = imported.matches;
      matchesWithVotes = imported.matchesWithVotes;
      playersMatched = imported.players;
      missingMatches = imported.missing;
    } catch (error) {
      note = error instanceof Error ? error.message : "Lettura voti non riuscita.";
    }

    let scored = week.status === "scored" || week.status === "final";
    let teamsScored = 0;
    const canScore = matches > 0 && matchesWithVotes === matches && realGrades > 0 && (lineupsFiled + lineupsAlreadyThere) > 0;
    if (scored) {
      note = note || "Giornata già calcolata. Formazioni mancanti inserite, punteggi non riscritti.";
    } else if (!canScore) {
      note = note || (realGrades === 0
        ? "Nessun voto reale pubblicato per questa giornata."
        : "Voti reali incompleti: il calcolo non è stato chiuso.");
    } else {
      const outcome = await scoreOfficialGameweek(gameweekId);
      if (outcome.skipped) {
        note = outcome.reason ?? "Calcolo non eseguito.";
      } else {
        const stamp = new Date().toISOString();
        let statusUpdate = await admin.from("gameweeks").update({ status: "scored", scored_at: stamp }).eq("id", gameweekId);
        if (statusUpdate.error && /scored_at/i.test(statusUpdate.error.message)) {
          statusUpdate = await admin.from("gameweeks").update({ status: "scored" }).eq("id", gameweekId);
        }
        if (statusUpdate.error) throw new Error(schemaHint(statusUpdate.error.message));
        scored = true;
        teamsScored = outcome.teams;
        note = `Calcolata con i voti reali. Squadre: ${outcome.teams}.`;
      }
    }

    weeks.push({
      number,
      lineupsFiled,
      lineupsAlreadyThere,
      realGrades,
      matches,
      matchesWithVotes,
      playersMatched,
      missingMatches,
      scored,
      teamsScored,
      note,
    });
  }

  return {
    season: season.code,
    leagues: leagues.map((league) => league.name),
    rostersCreated,
    rostersKept,
    rosterProblems,
    weeks,
  };
}
