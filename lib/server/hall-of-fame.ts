import { publicHandle } from "@/lib/public-name";
import { weekScoreMode } from "@/lib/league-rules";
import { standingsFor, type GameweekRow } from "@/lib/server/league-hub";
import { readLeagueSettings } from "@/lib/server/league-settings";
import type { ScoreParts } from "@/lib/server/league-scores";
import { inChunks, readAllRows } from "@/lib/server/read-all";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type PodiumPlace = {
  teamId: string;
  /** Posizione in classifica: due squadre pari hanno la stessa. */
  rank: number;
  teamName: string;
  displayName: string;
  points: number;
};

export type NamedScore = {
  teamName: string;
  points: number;
  gameweek: number;
};

/** Chi primeggia in una statistica: più nomi se sono pari. */
export type Leader = { teams: string[]; value: number };

export type LeagueAwards = {
  /** Giornate chiuse con il punteggio più alto della lega. */
  roundWins: Leader | null;
  /** Punti presi dalla fascia di capitano. */
  captain: Leader | null;
  /** Punti presi dal modificatore difesa. */
  defense: Leader | null;
  /** Giornate con il bonus fair play (nessuna ammonizione). */
  fairPlay: Leader | null;
};

export type LeagueArchive = {
  leagueId: string;
  leagueName: string;
  podium: PodiumPlace[];
  /** Cosa conta la classifica: punti degli scontri diretti oppure somma dei fantapunti. */
  unit: "punti" | "fantapunti";
  bestWeek: NamedScore | null;
} & LeagueAwards;

export type SeasonArchive = {
  seasonId: string;
  seasonCode: string;
  leagues: LeagueArchive[];
};

export type HallOfFame = {
  seasons: SeasonArchive[];
};

type Member = {
  leagueId: string;
  teamId: string;
  teamName: string;
  userId: string;
};

type LeagueRow = {
  id: string;
  name: string;
  season_id: string;
  start_matchday?: number | null;
  end_matchday?: number | null;
};

/** Il punteggio di una squadra in una giornata, con le regole della sua lega. */
export type WeekScore = {
  teamId: string;
  gameweekId: string;
  total: number;
} & ScoreParts;

/** Quante leghe si calcolano insieme: ognuna legge formazioni e voti di tutta la stagione. */
const AT_ONCE = 4;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function leader(values: Map<string, number>, names: Map<string, string>): Leader | null {
  const top = Math.max(0, ...[...values.values()].map(round2));
  // Se nessuno ha preso niente (regola spenta in quella lega) la statistica non si mostra.
  if (top <= 0) return null;
  const teams = [...values]
    .filter(([, value]) => round2(value) === top)
    .map(([teamId]) => names.get(teamId) ?? "Squadra")
    .sort((left, right) => left.localeCompare(right, "it"));
  return { teams, value: top };
}

/** Le statistiche di una lega, dai punteggi salvati di ogni giornata. */
export function leagueAwards(scores: WeekScore[], names: Map<string, string>): LeagueAwards {
  const add = (map: Map<string, number>, teamId: string, value: number) => map.set(teamId, (map.get(teamId) ?? 0) + value);
  const wins = new Map<string, number>();
  const captain = new Map<string, number>();
  const defense = new Map<string, number>();
  const fairPlay = new Map<string, number>();
  const weeks = new Map<string, WeekScore[]>();
  for (const row of scores) {
    add(captain, row.teamId, row.captain);
    add(defense, row.teamId, row.defense);
    add(fairPlay, row.teamId, row.fairPlay > 0 ? 1 : 0);
    const week = weeks.get(row.gameweekId);
    if (week) week.push(row);
    else weeks.set(row.gameweekId, [row]);
  }
  for (const rows of weeks.values()) {
    const best = Math.max(...rows.map((row) => row.total));
    if (best <= 0) continue;
    for (const row of rows) {
      if (row.total === best) add(wins, row.teamId, 1);
    }
  }
  return {
    roundWins: leader(wins, names),
    captain: leader(captain, names),
    defense: leader(defense, names),
    fairPlay: leader(fairPlay, names),
  };
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Podio e statistiche di una lega chiusa. Il podio è la classifica della lega, calcolata
 * dalla stessa funzione della sua schermata: scontri diretti, ingressi in corsa, penalità.
 */
async function archiveOf(
  league: LeagueRow,
  members: Member[],
  names: Map<string, string>,
  seasonWeeks: GameweekRow[],
): Promise<LeagueArchive> {
  const empty: LeagueArchive = {
    leagueId: league.id,
    leagueName: league.name,
    podium: [],
    unit: "fantapunti",
    bestWeek: null,
    roundWins: null,
    captain: null,
    defense: null,
    fairPlay: null,
  };
  const start = league.start_matchday ?? 1;
  const end = league.end_matchday ?? 38;
  const weeks = seasonWeeks.filter((week) => week.number >= start && week.number <= end);
  const closed = weeks.filter((week) => week.status === "scored" || week.status === "final");
  if (members.length === 0 || closed.length === 0) return empty;

  const participants = members.map((member) => ({
    fantasyTeamId: member.teamId,
    userId: member.userId,
    teamName: member.teamName,
    displayName: names.get(member.userId) || "",
  }));
  const admin = createAdminSupabase();
  const parts = new Map<string, ScoreParts>();
  const [standings, settings] = await Promise.all([
    standingsFor(admin, { id: league.id, seasonId: league.season_id, startMatchday: start }, participants, weeks, Date.now(), new Set(), parts),
    readLeagueSettings(admin, league.id),
  ]);

  const scores: WeekScore[] = [];
  let best: NamedScore | null = null;
  for (const week of closed) {
    for (const member of members) {
      const key = `${member.teamId}:${week.id}`;
      const total = standings.weekPoints?.get(key);
      if (total === undefined) continue;
      scores.push({ teamId: member.teamId, gameweekId: week.id, total, ...(parts.get(key) ?? { captain: 0, defense: 0, fairPlay: 0 }) });
      if (total > 0 && (!best || total > best.points)) best = { teamName: member.teamName, points: round2(total), gameweek: week.number };
    }
  }

  return {
    ...empty,
    podium: standings.rows.slice(0, 3).map((row) => ({
      teamId: row.fantasyTeamId,
      rank: row.rank,
      teamName: row.teamName,
      displayName: row.displayName,
      points: row.points,
    })),
    unit: weeks.some((week) => weekScoreMode(settings.rules, week.number) === "head_to_head") ? "punti" : "fantapunti",
    bestWeek: best,
    ...leagueAwards(scores, new Map(members.map((member) => [member.teamId, member.teamName]))),
  };
}

export async function loadHallOfFame(): Promise<HallOfFame> {
  const admin = createAdminSupabase();
  const seasons = await admin.from("seasons").select("id, code").eq("status", "closed").order("code", { ascending: false });
  if (seasons.error) throw new Error(seasons.error.message);
  const seasonRows = seasons.data ?? [];
  if (seasonRows.length === 0) return { seasons: [] };

  const seasonIds = seasonRows.map((row) => row.id as string);
  const leagues = await admin
    .from("private_leagues")
    .select("id, name, season_id, start_matchday, end_matchday")
    .in("season_id", seasonIds);
  if (leagues.error) throw new Error(leagues.error.message);
  const leagueRows = (leagues.data ?? []) as LeagueRow[];

  const weeks = await admin
    .from("gameweeks")
    .select("id, number, season_id, status, deadline_at")
    .in("season_id", seasonIds)
    .order("number", { ascending: true });
  if (weeks.error) throw new Error(weeks.error.message);
  const weekRows = (weeks.data ?? []) as (GameweekRow & { season_id: string })[];

  const memberRows: Member[] = [];
  for (const ids of inChunks(leagueRows.map((row) => row.id))) {
    const page = await readAllRows((from, to) => admin
      .from("private_league_members")
      .select("private_league_id, fantasy_team_id, fantasy_teams(name, user_id)")
      .in("private_league_id", ids)
      .order("private_league_id")
      .order("fantasy_team_id")
      .range(from, to));
    if (page.error) throw new Error(page.error.message);
    for (const row of page.data) {
      const team = one(row.fantasy_teams as { name?: string; user_id?: string } | { name?: string; user_id?: string }[] | null);
      if (!row.fantasy_team_id || !row.private_league_id) continue;
      memberRows.push({
        leagueId: row.private_league_id as string,
        teamId: row.fantasy_team_id as string,
        teamName: team?.name || "Squadra",
        userId: team?.user_id ?? "",
      });
    }
  }

  const userIds = [...new Set(memberRows.map((member) => member.userId).filter(Boolean))];
  const names = new Map<string, string>();
  for (const ids of inChunks(userIds)) {
    const profiles = await admin.from("profiles").select("id, display_name").in("id", ids);
    if (profiles.error) throw new Error(profiles.error.message);
    for (const profile of profiles.data ?? []) {
      names.set(profile.id as string, publicHandle(profile.display_name as string));
    }
  }

  const archives = new Map<string, LeagueArchive>();
  for (const group of inChunks(leagueRows, AT_ONCE)) {
    const built = await Promise.all(group.map((league) => archiveOf(
      league,
      memberRows.filter((member) => member.leagueId === league.id),
      names,
      weekRows.filter((week) => week.season_id === league.season_id),
    )));
    for (const archive of built) archives.set(archive.leagueId, archive);
  }

  return {
    seasons: seasonRows.map((season) => ({
      seasonId: season.id as string,
      seasonCode: season.code as string,
      leagues: leagueRows
        .filter((league) => league.season_id === season.id)
        .flatMap((league) => archives.get(league.id) ?? [])
        .sort((left, right) => left.leagueName.localeCompare(right.leagueName, "it")),
    })),
  };
}
