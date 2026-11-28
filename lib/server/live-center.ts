import { projectLiveScore, type PlayerStat } from "@/lib/engine/calculator";
import { eventLines } from "@/lib/engine/score-audit";
import { eventsFromLines, type CompactPlayer } from "@/lib/lineups/compact-sheet";
import { entryPolicy, weekGain } from "@/lib/late-entry";
import { fantapuntiToGoals, headToHeadPairings, headToHeadPoints, inLeagueRange, weekScoreMode } from "@/lib/league-rules";
import { pitchEvents } from "@/lib/engagement/live-board";
import { teamWeekPoints } from "@/lib/office-lineup";
import { fantasyPointsForLeague, leagueEntries, waitingEntries } from "@/lib/server/league-scores";
import { definitionForLeague } from "@/lib/server/league-settings";
import { previewProvisional } from "@/lib/server/live-score";
import { reportError } from "@/lib/server/error-report";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { LeagueDetail } from "@/lib/types";
import type { PlayerRole } from "@/lib/types";

type LiveCard = {
  id: string;
  name: string;
  role: PlayerRole;
  voto: number | null;
  bonus: number;
  malus: number;
  events: CompactPlayer["events"];
};

export type LiveCenter = {
  phase: "live" | "countdown" | "none";
  gameweekNumber: number | null;
  gameweekId: string | null;
  mode: "sum" | "head_to_head" | "knockout";
  checkedAt: string;
  mine: {
    teamName: string;
    total: number;
    /** Formazione d'ufficio: non salvata in tempo, vale quella che registrerà il calcolo. */
    office?: boolean;
    starters: LiveCard[];
    bench: LiveCard[];
  } | null;
  opponent: { teamName: string; total: number; goalsFor: number; goalsAgainst: number } | null;
  table: { teamName: string; points: number; live: number }[];
  events: { playerName: string; teamName: string; label: string }[];
};

export async function loadLiveCenter(league: LeagueDetail, userId: string, now = new Date()): Promise<LiveCenter> {
  const empty: LiveCenter = {
    phase: "none",
    gameweekNumber: null,
    gameweekId: null,
    mode: "sum",
    checkedAt: now.toISOString(),
    mine: null,
    opponent: null,
    table: [],
    events: [],
  };
  const admin = createAdminSupabase();
  const weeks = await admin
    .from("gameweeks")
    .select("id, number, status, deadline_at")
    .eq("season_id", league.seasonId)
    .order("number");
  if (weeks.error) throw new Error(weeks.error.message);
  const range = { from: league.startMatchday, to: league.endMatchday };
  const rows = (weeks.data ?? []).filter((row) => inLeagueRange(range, Number(row.number)));
  const liveWeek = [...rows].reverse().find((row) => row.status === "open" || row.status === "locked")
    ?? rows.find((row) => row.status === "scheduled");
  if (!liveWeek) return empty;
  const number = Number(liveWeek.number);
  const mode = weekScoreMode(league.rules, number);
  const phase = liveWeek.status === "scheduled" ? "countdown" : "live";
  let preview: Awaited<ReturnType<typeof previewProvisional>> | null = null;
  try {
    preview = await previewProvisional(liveWeek.id as string, now);
  } catch (error) {
    void reportError("Lega: centro partite, punteggi in diretta", error);
    preview = null;
  }
  const teamIds = league.participants.map((participant) => participant.fantasyTeamId);
  const names = new Map(league.participants.map((participant) => [participant.fantasyTeamId, participant.teamName]));
  const closed = rows
    .filter((row) => (row.status === "scored" || row.status === "final") && Number(row.number) < number && weekScoreMode(league.rules, Number(row.number)) !== "knockout")
    .map((row) => ({ id: row.id as string, number: Number(row.number) }));
  const base = new Map<string, number>();
  if (closed.length > 0) {
    try {
      const [points, entries] = await Promise.all([
        fantasyPointsForLeague(league.id, league.seasonId, teamIds, closed),
        leagueEntries(teamIds, rows.map((row) => ({ id: row.id as string, number: Number(row.number) }))),
      ]);
      // Stessi punti della classifica di lega: media per chi è entrato in corsa, punti partita negli scontri.
      const entryContext = {
        teamIds,
        entryByTeam: entries.entryByTeam,
        startMatchday: league.startMatchday,
        ...entryPolicy(league.rules),
        waiting: await waitingEntries(
          teamIds,
          entries.entryByTeam,
          rows.map((row) => ({ number: Number(row.number), deadlineAt: row.deadline_at as string })),
          league.startMatchday,
          now.getTime(),
        ),
      };
      for (const week of closed) {
        const fantasy = new Map(teamIds.map((teamId) => [teamId, points.get(`${teamId}:${week.id}`) ?? 0]));
        const awarded = weekScoreMode(league.rules, week.number) === "head_to_head"
          ? headToHeadPoints(teamIds, week.number, fantasy, league.rules.goalBands)
          : fantasy;
        for (const teamId of teamIds) {
          const gained = weekGain(entryContext, entries.fielded, teamId, week, (id) => awarded.get(id) ?? 0);
          base.set(teamId, (base.get(teamId) ?? 0) + gained);
        }
      }
    } catch (error) {
      void reportError("Lega: centro partite, classifica", error);
      // La classifica live resta sulla giornata in corso.
    }
  }
  if (!preview) {
    return { ...empty, phase, gameweekNumber: number, gameweekId: liveWeek.id as string, mode };
  }
  const stats = preview.stats;
  const { definition, rules } = await definitionForLeague(admin, league.id, preview.definition, preview.gameweekNumber);
  const leagueLineups = preview.lineups.filter((lineup) => teamIds.includes(lineup.fantasyTeamId));
  const scores = new Map(leagueLineups.map((lineup) => [
    lineup.fantasyTeamId,
    projectLiveScore(lineup.fantasyTeamId, liveWeek.id as string, lineup.slots, stats, definition),
  ]));
  const office = new Set(leagueLineups.filter((lineup) => lineup.office).map((lineup) => lineup.fantasyTeamId));
  // Dopo la chiusura valgono le regole del calcolo finale per chi non ha salvato (penalità comprese).
  const closedAt = Date.parse(String(liveWeek.deadline_at ?? ""));
  const deadlinePassed = liveWeek.status === "locked" || (Number.isFinite(closedAt) && closedAt <= now.getTime());
  const livePoints = new Map<string, number>();
  for (const teamId of teamIds) {
    const points = scores.get(teamId)?.total ?? null;
    const counted = deadlinePassed ? teamWeekPoints(rules, { points, office: office.has(teamId) }) : points;
    if (counted !== null) livePoints.set(teamId, counted);
  }
  const weekPoints = new Map<string, number>();
  if (mode === "sum") {
    for (const teamId of teamIds) weekPoints.set(teamId, livePoints.get(teamId) ?? 0);
  } else if (mode === "head_to_head") {
    const { pairs, bye } = headToHeadPairings(teamIds, number);
    const goals = (teamId: string) => {
      const points = livePoints.get(teamId) ?? 0;
      return league.rules.goalBands.length > 0 ? fantapuntiToGoals(points, league.rules.goalBands) : points;
    };
    for (const pair of pairs) {
      const home = goals(pair.home);
      const away = goals(pair.away);
      if (home === away) {
        weekPoints.set(pair.home, 1);
        weekPoints.set(pair.away, 1);
      } else if (home > away) {
        weekPoints.set(pair.home, 3);
        weekPoints.set(pair.away, 0);
      } else {
        weekPoints.set(pair.home, 0);
        weekPoints.set(pair.away, 3);
      }
    }
    if (bye) weekPoints.set(bye, 3);
  }
  const table = teamIds
    .map((teamId) => ({
      teamName: names.get(teamId) ?? "Squadra",
      // Prima dell'inizio la giornata non assegna ancora punti (negli scontri lo 0-0 ne darebbe uno).
      points: round2((base.get(teamId) ?? 0) + (mode === "knockout" || phase === "countdown" ? 0 : weekPoints.get(teamId) ?? 0)),
      live: round2(livePoints.get(teamId) ?? 0),
    }))
    .sort((left, right) => right.points - left.points || left.teamName.localeCompare(right.teamName, "it"));

  const playerIds = [...new Set(leagueLineups.flatMap((lineup) => lineup.slots.map((slot) => slot.playerId)))];
  const people = playerIds.length
    ? await admin.from("players").select("id, full_name").in("id", playerIds)
    : { data: [], error: null };
  if (people.error) throw new Error(people.error.message);
  const playerName = new Map((people.data ?? []).map((row) => [row.id as string, row.full_name as string]));

  const viewerId = league.participants.find((participant) => participant.userId === userId)?.fantasyTeamId
    ?? leagueLineups[0]?.fantasyTeamId;
  const viewer = viewerId ? leagueLineups.find((lineup) => lineup.fantasyTeamId === viewerId) : undefined;
  const viewerScore = viewerId ? scores.get(viewerId) : undefined;
  const cardOf = (playerId: string, starter: boolean) => {
    const player = viewerScore?.players.find((item) => item.playerId === playerId);
    const stat = stats.get(playerId);
    const role = player?.role ?? stat?.role ?? "MID";
    return {
      id: playerId,
      name: playerName.get(playerId) ?? "Calciatore",
      role,
      events: eventsFromLines(eventLines(stat, role, definition, false)),
      voto: starter ? player?.voto ?? stat?.voto ?? null : stat?.voto ?? null,
      bonus: starter ? player?.bonusPoints ?? 0 : 0,
      malus: starter ? player?.malusPoints ?? 0 : 0,
    };
  };
  const mine = viewer ? {
    teamName: names.get(viewer.fantasyTeamId) ?? "La tua squadra",
    total: round2(livePoints.get(viewer.fantasyTeamId) ?? viewerScore?.total ?? 0),
    office: office.has(viewer.fantasyTeamId),
    starters: viewer.slots.filter((slot) => slot.benchOrder == null).map((slot) => cardOf(slot.playerId, true)),
    bench: viewer.slots.filter((slot) => slot.benchOrder != null).sort((left, right) => (left.benchOrder ?? 0) - (right.benchOrder ?? 0)).map((slot) => cardOf(slot.playerId, false)),
  } : null;

  let opponent: LiveCenter["opponent"] = null;
  if (mode !== "sum" && viewerId) {
    const pair = headToHeadPairings(teamIds, number).pairs.find((item) => item.home === viewerId || item.away === viewerId);
    if (pair) {
      const other = pair.home === viewerId ? pair.away : pair.home;
      const mineGoals = fantapuntiToGoals(livePoints.get(viewerId) ?? 0, league.rules.goalBands);
      const otherGoals = fantapuntiToGoals(livePoints.get(other) ?? 0, league.rules.goalBands);
      opponent = {
        teamName: names.get(other) ?? "Avversario",
        total: round2(livePoints.get(other) ?? 0),
        goalsFor: mineGoals,
        goalsAgainst: otherGoals,
      };
    }
  }

  const eventRows = leagueLineups.flatMap((lineup) => lineup.slots.filter((slot) => slot.benchOrder == null).map((slot) => ({
    playerId: slot.playerId,
    playerName: playerName.get(slot.playerId) ?? "Calciatore",
    teamName: names.get(lineup.fantasyTeamId) ?? "Squadra",
    stat: stats.get(slot.playerId) ?? emptyStat(slot.playerId),
  })));

  return {
    phase,
    gameweekNumber: number,
    gameweekId: liveWeek.id as string,
    mode,
    checkedAt: now.toISOString(),
    mine,
    opponent,
    table,
    events: pitchEvents(eventRows).map((event) => ({
      playerName: event.playerName,
      teamName: event.teamName,
      label: event.label,
    })),
  };
}

function emptyStat(playerId: string): PlayerStat {
  return { playerId, role: "MID", voto: null };
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
