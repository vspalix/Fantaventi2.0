import { publicHandle } from "@/lib/public-name";
import { inChunks, readAllRows } from "@/lib/server/read-all";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type PodiumPlace = {
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

export type ScoreRow = {
  fantasy_team_id: string;
  gameweek_id: string;
  total: number | string;
  captain_modifier?: number | string | null;
  defense_modifier?: number | string | null;
  fair_play?: number | string | null;
};

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
export function leagueAwards(scores: ScoreRow[], names: Map<string, string>): LeagueAwards {
  const add = (map: Map<string, number>, teamId: string, value: number) => map.set(teamId, (map.get(teamId) ?? 0) + value);
  const wins = new Map<string, number>();
  const captain = new Map<string, number>();
  const defense = new Map<string, number>();
  const fairPlay = new Map<string, number>();
  const weeks = new Map<string, ScoreRow[]>();
  for (const row of scores) {
    add(captain, row.fantasy_team_id, Number(row.captain_modifier ?? 0));
    add(defense, row.fantasy_team_id, Number(row.defense_modifier ?? 0));
    add(fairPlay, row.fantasy_team_id, Number(row.fair_play ?? 0) > 0 ? 1 : 0);
    const week = weeks.get(row.gameweek_id);
    if (week) week.push(row);
    else weeks.set(row.gameweek_id, [row]);
  }
  for (const rows of weeks.values()) {
    const best = Math.max(...rows.map((row) => Number(row.total ?? 0)));
    if (best <= 0) continue;
    for (const row of rows) {
      if (Number(row.total ?? 0) === best) add(wins, row.fantasy_team_id, 1);
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

export async function loadHallOfFame(): Promise<HallOfFame> {
  const admin = createAdminSupabase();
  const seasons = await admin.from("seasons").select("id, code").eq("status", "closed").order("code", { ascending: false });
  if (seasons.error) throw new Error(seasons.error.message);
  const seasonRows = seasons.data ?? [];
  if (seasonRows.length === 0) return { seasons: [] };

  const seasonIds = seasonRows.map((row) => row.id as string);
  const ranged = await admin
    .from("private_leagues")
    .select("id, name, season_id, start_matchday, end_matchday")
    .in("season_id", seasonIds);
  const leagues = ranged.error && /start_matchday|end_matchday|schema cache|could not find/i.test(ranged.error.message)
    ? await admin.from("private_leagues").select("id, name, season_id").in("season_id", seasonIds)
    : ranged;
  if (leagues.error) throw new Error(leagues.error.message);

  const leagueRows = (leagues.data ?? []) as {
    id: string;
    name: string;
    season_id: string;
    start_matchday?: number | null;
    end_matchday?: number | null;
  }[];
  const leagueIds = leagueRows.map((row) => row.id);
  const weeks = await admin
    .from("gameweeks")
    .select("id, number, season_id, status")
    .in("season_id", seasonIds)
    .in("status", ["scored", "final"]);
  if (weeks.error) throw new Error(weeks.error.message);
  const weekRows = (weeks.data ?? []) as { id: string; number: number; season_id: string }[];
  const weekById = new Map(weekRows.map((week) => [week.id, week]));

  const members = leagueIds.length === 0
    ? { data: [], error: null }
    : await admin
      .from("private_league_members")
      .select("private_league_id, fantasy_team_id, fantasy_teams(name, user_id)")
      .in("private_league_id", leagueIds);
  if (members.error) throw new Error(members.error.message);

  const memberRows: Member[] = (members.data ?? []).flatMap((row) => {
    const team = one(row.fantasy_teams as { name?: string; user_id?: string } | { name?: string; user_id?: string }[] | null);
    if (!row.fantasy_team_id || !row.private_league_id) return [];
    return [{
      leagueId: row.private_league_id as string,
      teamId: row.fantasy_team_id as string,
      teamName: team?.name || "Squadra",
      userId: team?.user_id ?? "",
    }];
  });

  const userIds = [...new Set(memberRows.map((member) => member.userId).filter(Boolean))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const profiles = await admin.from("profiles").select("id, display_name").in("id", userIds);
    if (!profiles.error) {
      for (const profile of profiles.data ?? []) {
        names.set(profile.id as string, publicHandle(profile.display_name as string));
      }
    }
  }

  const weekIds = weekRows.map((week) => week.id);
  const teamIds = [...new Set(memberRows.map((member) => member.teamId))];
  const scoreRows = await loadScores(weekIds, teamIds);

  const bySeason = new Map<string, SeasonArchive>();
  for (const season of seasonRows) {
    bySeason.set(season.id as string, { seasonId: season.id as string, seasonCode: season.code as string, leagues: [] });
  }

  for (const league of leagueRows) {
    const season = bySeason.get(league.season_id);
    if (!season) continue;
    const roster = memberRows.filter((member) => member.leagueId === league.id);
    const teamSet = new Set(roster.map((member) => member.teamId));
    const start = league.start_matchday ?? 1;
    const end = league.end_matchday ?? 38;
    const inRange = (gameweekId: string) => {
      const week = weekById.get(gameweekId);
      return Boolean(week && week.season_id === league.season_id && week.number >= start && week.number <= end);
    };
    const scores = scoreRows.filter((row) => teamSet.has(row.fantasy_team_id) && inRange(row.gameweek_id));
    const totals = new Map<string, number>();
    let best: NamedScore | null = null;
    const teamName = new Map(roster.map((member) => [member.teamId, member.teamName]));
    for (const row of scores) {
      const total = Number(row.total ?? 0);
      totals.set(row.fantasy_team_id, round2((totals.get(row.fantasy_team_id) ?? 0) + total));
      const week = weekById.get(row.gameweek_id);
      const candidate = { teamName: teamName.get(row.fantasy_team_id) ?? "Squadra", points: round2(total), gameweek: week?.number ?? 0 };
      if (!best || candidate.points > best.points) best = candidate;
    }
    const ranked = roster
      .map((member) => ({
        teamName: member.teamName,
        displayName: names.get(member.userId) || "",
        points: totals.get(member.teamId) ?? 0,
      }))
      .sort((left, right) => right.points - left.points || left.teamName.localeCompare(right.teamName, "it"));
    const podium = ranked.slice(0, 3).map((row, index) => ({ rank: index + 1, ...row, points: round2(row.points) }));
    season.leagues.push({
      leagueId: league.id,
      leagueName: league.name,
      podium: scores.length === 0 ? [] : podium,
      bestWeek: best,
      ...leagueAwards(scores, teamName),
    });
  }

  return {
    seasons: [...bySeason.values()].map((season) => ({
      ...season,
      leagues: season.leagues.sort((left, right) => left.leagueName.localeCompare(right.leagueName, "it")),
    })),
  };
}

async function loadScores(weekIds: string[], teamIds: string[]) {
  const rows: ScoreRow[] = [];
  if (weekIds.length === 0) return rows;
  const admin = createAdminSupabase();
  // Una stagione intera supera presto le righe di una sola richiesta: si legge a blocchi e a pagine.
  for (const ids of inChunks(teamIds, 80)) {
    const page = await readAllRows<ScoreRow>((from, to) => admin
      .from("team_gameweek_scores")
      .select("fantasy_team_id, gameweek_id, total, captain_modifier, defense_modifier, fair_play")
      .in("gameweek_id", weekIds)
      .in("fantasy_team_id", ids)
      .order("fantasy_team_id")
      .order("gameweek_id")
      .range(from, to));
    if (page.error) throw new Error(page.error.message);
    rows.push(...page.data);
  }
  return rows;
}
