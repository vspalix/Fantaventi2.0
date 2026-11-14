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

export type LeagueArchive = {
  leagueId: string;
  leagueName: string;
  podium: PodiumPlace[];
  bestWeek: NamedScore | null;
  worstDefense: NamedScore | null;
  defenseUsed: boolean;
  topScorer: { playerName: string; goals: number } | null;
};

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

type ScoreRow = {
  fantasy_team_id: string;
  gameweek_id: string;
  total: number | string;
  defense_modifier?: number | string | null;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
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
        names.set(profile.id as string, (profile.display_name as string) || "Giocatore");
      }
    }
  }

  const weekIds = weekRows.map((week) => week.id);
  const teamIds = [...new Set(memberRows.map((member) => member.teamId))];
  const scoreRows = await loadScores(weekIds, teamIds);
  const scorers = await loadTopScorers(weekIds, teamIds, memberRows);

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
    let worst: NamedScore | null = null;
    let defenseUsed = false;
    const teamName = new Map(roster.map((member) => [member.teamId, member.teamName]));
    for (const row of scores) {
      const total = Number(row.total ?? 0);
      totals.set(row.fantasy_team_id, round2((totals.get(row.fantasy_team_id) ?? 0) + total));
      const week = weekById.get(row.gameweek_id);
      const candidate = { teamName: teamName.get(row.fantasy_team_id) ?? "Squadra", points: round2(total), gameweek: week?.number ?? 0 };
      if (!best || candidate.points > best.points) best = candidate;
      if (row.defense_modifier !== undefined && row.defense_modifier !== null) {
        const modifier = Number(row.defense_modifier);
        if (modifier !== 0) defenseUsed = true;
        const defense = { ...candidate, points: round2(modifier) };
        if (!worst || defense.points < worst.points) worst = defense;
      }
    }
    const ranked = roster
      .map((member) => ({
        teamName: member.teamName,
        displayName: names.get(member.userId) || "Giocatore",
        points: totals.get(member.teamId) ?? 0,
      }))
      .sort((left, right) => right.points - left.points || left.teamName.localeCompare(right.teamName, "it"));
    const podium = ranked.slice(0, 3).map((row, index) => ({ rank: index + 1, ...row, points: round2(row.points) }));
    season.leagues.push({
      leagueId: league.id,
      leagueName: league.name,
      podium: scores.length === 0 ? [] : podium,
      bestWeek: best,
      worstDefense: defenseUsed ? worst : null,
      defenseUsed,
      topScorer: scorers.get(league.id) ?? null,
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
  if (weekIds.length === 0 || teamIds.length === 0) return [] as ScoreRow[];
  const admin = createAdminSupabase();
  const rows: ScoreRow[] = [];
  for (let index = 0; index < teamIds.length; index += 80) {
    const slice = teamIds.slice(index, index + 80);
    const withDefense = await admin
      .from("team_gameweek_scores")
      .select("fantasy_team_id, gameweek_id, total, defense_modifier")
      .in("gameweek_id", weekIds)
      .in("fantasy_team_id", slice)
      .limit(5000);
    const plain = withDefense.error && /defense_modifier|schema cache|could not find/i.test(withDefense.error.message)
      ? await admin
        .from("team_gameweek_scores")
        .select("fantasy_team_id, gameweek_id, total")
        .in("gameweek_id", weekIds)
        .in("fantasy_team_id", slice)
        .limit(5000)
      : withDefense;
    if (plain.error) throw new Error(plain.error.message);
    rows.push(...((plain.data ?? []) as ScoreRow[]));
  }
  return rows;
}

async function loadTopScorers(weekIds: string[], teamIds: string[], members: Member[]) {
  const result = new Map<string, { playerName: string; goals: number }>();
  if (weekIds.length === 0 || teamIds.length === 0) return result;
  const admin = createAdminSupabase();
  const lineups: { id: string; fantasy_team_id: string; gameweek_id: string }[] = [];
  for (let index = 0; index < teamIds.length; index += 80) {
    const listed = await admin
      .from("lineups")
      .select("id, fantasy_team_id, gameweek_id")
      .in("gameweek_id", weekIds)
      .in("fantasy_team_id", teamIds.slice(index, index + 80))
      .limit(5000);
    if (listed.error) return result;
    lineups.push(...((listed.data ?? []) as { id: string; fantasy_team_id: string; gameweek_id: string }[]));
  }
  if (lineups.length === 0) return result;

  const lineupById = new Map(lineups.map((lineup) => [lineup.id, lineup]));
  const started = new Set<string>();
  const lineupIds = lineups.map((lineup) => lineup.id);
  for (let index = 0; index < lineupIds.length; index += 150) {
    const slots = await admin
      .from("lineup_slots")
      .select("lineup_id, player_id, is_starter")
      .in("lineup_id", lineupIds.slice(index, index + 150));
    if (slots.error) return result;
    for (const slot of slots.data ?? []) {
      if (slot.is_starter === false) continue;
      const lineup = lineupById.get(slot.lineup_id as string);
      if (!lineup) continue;
      started.add(`${lineup.fantasy_team_id}:${lineup.gameweek_id}:${slot.player_id as string}`);
    }
  }

  const stats = await admin
    .from("player_gameweek_stats")
    .select("player_id, gameweek_id, goals")
    .in("gameweek_id", weekIds)
    .gt("goals", 0)
    .limit(5000);
  if (stats.error) return result;

  const leaguesByTeam = new Map<string, string[]>();
  for (const member of members) {
    const list = leaguesByTeam.get(member.teamId) ?? [];
    list.push(member.leagueId);
    leaguesByTeam.set(member.teamId, list);
  }
  const goals = new Map<string, number>();
  const seen = new Set<string>();
  for (const stat of stats.data ?? []) {
    const playerId = stat.player_id as string;
    const gameweekId = stat.gameweek_id as string;
    for (const [teamId, leagueIds] of leaguesByTeam) {
      if (!started.has(`${teamId}:${gameweekId}:${playerId}`)) continue;
      for (const leagueId of leagueIds) {
        const once = `${leagueId}:${playerId}:${gameweekId}`;
        if (seen.has(once)) continue;
        seen.add(once);
        const key = `${leagueId}:${playerId}`;
        goals.set(key, (goals.get(key) ?? 0) + Number(stat.goals ?? 0));
      }
    }
  }

  const bestByLeague = new Map<string, { playerId: string; goals: number }>();
  for (const [key, total] of goals) {
    const [leagueId, playerId] = key.split(":");
    const current = bestByLeague.get(leagueId);
    if (!current || total > current.goals) bestByLeague.set(leagueId, { playerId, goals: total });
  }
  const playerIds = [...new Set([...bestByLeague.values()].map((row) => row.playerId))];
  const playerNames = new Map<string, string>();
  if (playerIds.length > 0) {
    const players = await admin.from("players").select("id, full_name").in("id", playerIds);
    if (!players.error) {
      for (const player of players.data ?? []) playerNames.set(player.id as string, (player.full_name as string) || "Calciatore");
    }
  }
  for (const [leagueId, best] of bestByLeague) {
    result.set(leagueId, { playerName: playerNames.get(best.playerId) ?? "Calciatore", goals: best.goals });
  }
  return result;
}
