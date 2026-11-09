import { projectLiveScore, type PlayerStat } from "@/lib/engine/calculator";
import { fantapuntiToGoals, headToHeadPairings, weekScoreMode } from "@/lib/league-rules";
import { pitchEvents } from "@/lib/engagement/live-board";
import { fantasyPointsForLeague } from "@/lib/server/league-scores";
import { definitionForLeague } from "@/lib/server/league-settings";
import { overlayPublishedVotes } from "@/lib/server/live-projection";
import { previewProvisional } from "@/lib/server/live-score";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { LeagueDetail } from "@/lib/types";
import type { PlayerRole } from "@/lib/types";

export type LiveCenter = {
  phase: "live" | "countdown" | "none";
  gameweekNumber: number | null;
  gameweekId: string | null;
  mode: "sum" | "head_to_head" | "knockout";
  checkedAt: string;
  mine: {
    teamName: string;
    total: number;
    starters: { id: string; name: string; role: PlayerRole; voto: number | null; bonus: number; malus: number }[];
    bench: { id: string; name: string; role: PlayerRole; voto: number | null; bonus: number; malus: number }[];
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
  const rows = weeks.data ?? [];
  const liveWeek = [...rows].reverse().find((row) => row.status === "open" || row.status === "locked")
    ?? rows.find((row) => row.status === "scheduled");
  if (!liveWeek) return empty;
  const number = Number(liveWeek.number);
  const mode = weekScoreMode(league.rules, number);
  const phase = liveWeek.status === "scheduled" ? "countdown" : "live";
  let preview: Awaited<ReturnType<typeof previewProvisional>> | null = null;
  try {
    preview = await previewProvisional(liveWeek.id as string);
  } catch {
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
      const points = await fantasyPointsForLeague(league.id, league.seasonId, teamIds, closed);
      for (const [key, value] of points) {
        const teamId = key.split(":")[0];
        base.set(teamId, (base.get(teamId) ?? 0) + value);
      }
    } catch {
      // La classifica live resta sulla giornata in corso.
    }
  }
  if (!preview) {
    return { ...empty, phase, gameweekNumber: number, gameweekId: liveWeek.id as string, mode };
  }
  const roles = new Map<string, PlayerRole>();
  for (const lineup of preview.lineups) {
    for (const slot of lineup.slots) {
      if (slot.role) roles.set(slot.playerId, slot.role);
    }
  }
  const stats = await overlayPublishedVotes(preview.stats, league.seasonCode, number, roles);
  const { definition } = await definitionForLeague(admin, league.id, preview.definition);
  const leagueLineups = preview.lineups.filter((lineup) => teamIds.includes(lineup.fantasyTeamId));
  const scores = new Map(leagueLineups.map((lineup) => [
    lineup.fantasyTeamId,
    projectLiveScore(lineup.fantasyTeamId, liveWeek.id as string, lineup.slots, stats, definition),
  ]));
  const livePoints = new Map<string, number>();
  for (const [teamId, score] of scores) livePoints.set(teamId, score.total);
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
      points: round2((base.get(teamId) ?? 0) + (mode === "knockout" ? 0 : weekPoints.get(teamId) ?? 0)),
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
    return {
      id: playerId,
      name: playerName.get(playerId) ?? "Calciatore",
      role: player?.role ?? stat?.role ?? "MID",
      voto: starter ? player?.voto ?? stat?.voto ?? null : stat?.voto ?? null,
      bonus: starter ? player?.bonusPoints ?? 0 : 0,
      malus: starter ? player?.malusPoints ?? 0 : 0,
    };
  };
  const mine = viewer ? {
    teamName: names.get(viewer.fantasyTeamId) ?? "La tua squadra",
    total: round2(viewerScore?.total ?? 0),
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
