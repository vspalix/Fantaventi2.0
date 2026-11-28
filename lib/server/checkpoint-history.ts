import { entryCredit, entryPolicy } from "@/lib/late-entry";
import { headToHeadPoints, weekScoreMode, type LeagueRules, type MarketCheckpoint } from "@/lib/league-rules";
import { isHeldMatch } from "@/lib/server/held-lineup";
import { fantasyPointsForLeague, leagueEntries } from "@/lib/server/league-scores";
import { reportError } from "@/lib/server/error-report";
import { readAllChunks } from "@/lib/server/read-all";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { CheckpointHistory } from "@/lib/types";

type Person = { fantasyTeamId: string; teamName: string };
type Week = { id: string; number: number; status: string };

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export async function loadCheckpointHistory(input: {
  leagueId: string;
  seasonId: string;
  teamId: string | null;
  startMatchday: number;
  checkpoints: MarketCheckpoint[];
  participants: Person[];
  gameweeks: Week[];
  rules: LeagueRules;
  knownPoints?: Map<string, number> | null;
}): Promise<CheckpointHistory> {
  const ordered = [...input.checkpoints].sort((left, right) => left.afterMatchday - right.afterMatchday);
  const scored = input.gameweeks.filter((week) => week.status === "scored" || week.status === "final");
  const scoredNumbers = new Set(scored.map((week) => week.number));
  const nextAfter = ordered.find((item) => !scoredNumbers.has(item.afterMatchday))?.afterMatchday ?? null;
  const done = ordered.filter((item) => scoredNumbers.has(item.afterMatchday));
  const configured = ordered.length > 0;
  if (
    !input.teamId
    || done.length === 0
    || !input.participants.some((person) => person.fantasyTeamId === input.teamId)
  ) {
    return { rows: [], nextAfter, configured };
  }
  const teamId = input.teamId;

  const admin = createAdminSupabase();
  const teamIds = input.participants.map((person) => person.fantasyTeamId);
  const through = Math.max(...done.map((item) => item.afterMatchday));
  const horizon = input.gameweeks.filter((week) => week.number <= through);
  const weeks = horizon.filter((week) => week.status === "scored" || week.status === "final");
  let weekPoints: Map<string, number> | null = null;
  if (input.knownPoints !== undefined) {
    weekPoints = input.knownPoints;
  } else {
    try {
      weekPoints = await fantasyPointsForLeague(input.leagueId, input.seasonId, teamIds, weeks);
    } catch (error) {
      void reportError("Lega: storico dei checkpoint", error);
      weekPoints = null;
    }
  }

  const stored = new Map<string, number>();
  if (weeks.length > 0) {
    const totals = await readAllChunks(teamIds, (ids, from, to) => admin
      .from("team_gameweek_scores")
      .select("fantasy_team_id, gameweek_id, total")
      .in("fantasy_team_id", ids)
      .in("gameweek_id", weeks.map((week) => week.id))
      .order("fantasy_team_id")
      .order("gameweek_id")
      .range(from, to));
    if (!totals.error) {
      for (const row of totals.data) {
        stored.set(`${row.fantasy_team_id as string}:${row.gameweek_id as string}`, Number(row.total ?? 0));
      }
    }
  }

  const held = input.rules.postponement === "wait_recovery"
    ? await heldWeekIds(weeks.map((week) => week.id))
    : new Set<string>();
  const { entryByTeam, fielded } = await leagueEntries(teamIds, weeks.length > 0 ? horizon : []).catch((error: unknown) => {
    void reportError("Lega: formazioni nello storico dei checkpoint", error);
    return { entryByTeam: new Map<string, number>(), fielded: new Set<string>() };
  });

  const marks = new Map<string, { bonus: number; malus: number }>();
  if (weeks.length > 0) {
    const playerScores = await admin
      .from("lineup_player_scores")
      .select("gameweek_id, bonus_points, malus_points")
      .eq("fantasy_team_id", teamId)
      .in("gameweek_id", weeks.map((week) => week.id));
    if (!playerScores.error) {
      for (const row of playerScores.data ?? []) {
        const current = marks.get(row.gameweek_id as string) ?? { bonus: 0, malus: 0 };
        current.bonus += Number(row.bonus_points ?? 0);
        current.malus += Number(row.malus_points ?? 0);
        marks.set(row.gameweek_id as string, current);
      }
    }
  }

  const numberById = new Map(weeks.map((week) => [week.id, week.number]));
  const fantasyOf = (teamId: string, gameweekId: string) => {
    const key = `${teamId}:${gameweekId}`;
    if (weekPoints?.has(key)) return weekPoints.get(key) ?? 0;
    return stored.get(key) ?? 0;
  };
  const modeOf = (matchday: number) => weekScoreMode(input.rules, matchday);

  return {
    nextAfter,
    configured,
    rows: done.map((checkpoint) => {
      const base = weeks.filter((week) => {
        if (week.number > checkpoint.afterMatchday) return false;
        const mode = modeOf(week.number);
        if (mode === "knockout") return false;
        if (mode === "head_to_head" && held.has(week.id)) return false;
        return true;
      });
      const matchPoints = new Map<string, number>();
      for (const week of base) {
        if (modeOf(week.number) !== "head_to_head") continue;
        const fantasy = new Map(input.participants.map((person) => [person.fantasyTeamId, fantasyOf(person.fantasyTeamId, week.id)]));
        const awarded = headToHeadPoints(
          input.participants.map((person) => person.fantasyTeamId),
          week.number,
          fantasy,
          input.rules.goalBands,
        );
        for (const [teamId, points] of awarded) matchPoints.set(`${teamId}:${week.id}`, points);
      }
      const pointsOf = (teamId: string, gameweekId: string) => {
        const number = numberById.get(gameweekId) ?? 0;
        if (modeOf(number) === "head_to_head") return matchPoints.get(`${teamId}:${gameweekId}`) ?? 0;
        return fantasyOf(teamId, gameweekId);
      };
      const entryContext = {
        teamIds,
        entryByTeam,
        startMatchday: input.startMatchday,
        ...entryPolicy(input.rules),
      };
      const ranked = input.participants.map((person) => {
        const credit = entryCredit(entryContext, person.fantasyTeamId, base, pointsOf);
        const { entry } = credit;
        const counted = entry !== null
          ? base.filter((week) => week.number >= entry && fielded.has(`${person.fantasyTeamId}:${week.id}`))
          : base;
        const realPoints = counted.reduce((sum, week) => sum + pointsOf(person.fantasyTeamId, week.id), 0);
        const entryPoints = credit.points;
        return {
          fantasyTeamId: person.fantasyTeamId,
          teamName: person.teamName,
          points: round2(realPoints + entryPoints),
          realPoints: round2(realPoints),
        };
      }).sort((left, right) => right.points - left.points || right.realPoints - left.realPoints || left.teamName.localeCompare(right.teamName, "it"));
      let lastKey = "";
      let lastRank = 0;
      const mine = ranked.map((row, index) => {
        const key = `${row.points}:${row.realPoints}`;
        const rank = key === lastKey ? lastRank : index + 1;
        lastKey = key;
        lastRank = rank;
        return { ...row, rank };
      }).find((row) => row.fantasyTeamId === teamId);
      let bonus = 0;
      let malus = 0;
      for (const week of weeks) {
        if (week.number > checkpoint.afterMatchday) continue;
        const mark = marks.get(week.id);
        if (!mark) continue;
        bonus += mark.bonus;
        malus += mark.malus;
      }
      return {
        afterMatchday: checkpoint.afterMatchday,
        points: mine?.points ?? 0,
        bonus: round2(bonus),
        malus: round2(malus),
        rank: mine?.rank ?? input.participants.length,
        teams: input.participants.length,
      };
    }),
  };
}

async function heldWeekIds(gameweekIds: string[]) {
  const held = new Set<string>();
  if (gameweekIds.length === 0) return held;
  const admin = createAdminSupabase();
  const withHold = await admin
    .from("real_matches")
    .select("gameweek_id, postponed, hold_status")
    .in("gameweek_id", gameweekIds);
  const plain = withHold.error && /hold_status|schema cache|could not find/i.test(withHold.error.message)
    ? await admin.from("real_matches").select("gameweek_id, postponed").in("gameweek_id", gameweekIds)
    : withHold;
  if (plain.error) return held;
  for (const row of plain.data ?? []) {
    const item = row as { gameweek_id?: string; postponed?: boolean | null; hold_status?: string | null };
    if (item.gameweek_id && isHeldMatch(item)) held.add(item.gameweek_id);
  }
  return held;
}
