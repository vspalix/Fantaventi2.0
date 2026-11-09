import { createHash, randomUUID } from "node:crypto";
import { scoreLineup, ScoreEngineError, type PlayerStat, type RulesetDefinition, type TeamScore } from "@/lib/engine/calculator";
import { openFollowingGameweek } from "@/lib/server/gameweek-cycle";
import { definitionForLeague } from "@/lib/server/league-settings";
import { getLeagueDetail } from "@/lib/server/leagues";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

const VOTES = [5, 5.5, 6, 6.5, 7, 7.5, 8];

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function randomFor(key: string) {
  let state = 2166136261;
  for (const char of key) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mockStat(seed: string, playerId: string, role: PlayerRole): PlayerStat {
  const roll = randomFor(`${seed}:${playerId}`);
  const voto = roll() < 0.82 ? VOTES[Math.floor(roll() * VOTES.length)] : null;
  const yellowCards = voto !== null && roll() < 0.18 ? 1 : 0;
  const redCards = voto !== null && yellowCards === 0 && roll() < 0.04 ? 1 : 0;
  return {
    playerId,
    role,
    voto,
    goals: voto !== null && roll() < 0.14 ? (roll() < 0.2 ? 2 : 1) : 0,
    assists: voto !== null && roll() < 0.16 ? 1 : 0,
    yellowCards,
    redCards,
    penaltiesScored: 0,
    penaltiesMissed: voto !== null && roll() < 0.02 ? 1 : 0,
    penaltiesSaved: role === "GK" && voto !== null && roll() < 0.03 ? 1 : 0,
    ownGoals: voto !== null && roll() < 0.02 ? 1 : 0,
    goalsConceded: role === "GK" && voto !== null ? Math.floor(roll() * 3) : 0,
  };
}

export async function ensureMockVotes(
  admin: ReturnType<typeof createAdminSupabase>,
  seasonId: string,
  gameweek: { id: string; number: number },
) {
  const existing = await admin
    .from("vote_imports")
    .select("id", { count: "exact", head: true })
    .eq("gameweek_id", gameweek.id);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.count ?? 0) > 0) return { created: false, rated: 0, listone: 0 };

  const roster = await loadRegistrations(admin, seasonId, gameweek.number);
  if (roster.length === 0) {
    throw httpError("Nessun calciatore in listone: importa il listone prima dei voti di test.", 409);
  }
  const generated = roster.map((player) => mockStat(gameweek.id, player.playerId, player.role));
  await writeStats(admin, gameweek.id, generated, "Voti di test alla chiusura delle partite");
  return {
    created: true,
    rated: generated.filter((stat) => stat.voto !== null).length,
    listone: generated.length,
  };
}

export async function importFreshTestVotes(
  userId: string,
  input: { leagueId: string; gameweekId: string },
) {
  const league = await getLeagueDetail(userId, input.leagueId);
  if (!league.isOwner) throw httpError("Solo chi ha creato la lega può caricare i voti di test.", 403);

  const admin = createAdminSupabase();
  const gameweek = await loadGameweek(admin, league.seasonId, { gameweekId: input.gameweekId });
  if (gameweek.status === "final") {
    throw httpError(`La giornata ${gameweek.number} è final: i voti non si modificano.`, 409);
  }

  const roster = await loadRegistrations(admin, league.seasonId, gameweek.number);
  if (roster.length === 0) {
    throw httpError("Nessun calciatore in listone: importa il listone prima dei voti di test.", 409);
  }
  const generated = roster.map((player) => mockStat(`${randomUUID()}:${gameweek.id}`, player.playerId, player.role));

  const cleared = await admin.from("player_gameweek_stats").delete().eq("gameweek_id", gameweek.id);
  if (cleared.error) throw new Error(cleared.error.message);
  const removed = await admin.from("vote_imports").delete().eq("gameweek_id", gameweek.id);
  if (removed.error) throw new Error(removed.error.message);

  await writeStats(admin, gameweek.id, generated, "Voti di test");
  return {
    gameweekNumber: gameweek.number,
    rated: generated.filter((stat) => stat.voto !== null).length,
    listone: generated.length,
  };
}

export async function simulateLeagueGameweek(
  userId: string,
  input: { leagueId: string; gameweekId?: string; gameweekNumber?: number; status?: "scored" | "final" },
) {
  const league = await getLeagueDetail(userId, input.leagueId);
  if (!league.isOwner) throw httpError("Solo chi ha creato la lega può simulare una giornata.", 403);

  const admin = createAdminSupabase();
  const requestedStatus = input.status ?? "scored";
  const gameweek = await loadGameweek(admin, league.seasonId, input);
  if (gameweek.status === "final") {
    throw httpError(`La giornata ${gameweek.number} è final e non si ricalcola.`, 409);
  }

  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("ruleset_id, rulesets(definition)")
    .eq("id", league.seasonId)
    .single();
  if (seasonError) throw new Error(seasonError.message);
  const ruleset = Array.isArray(season.rulesets) ? season.rulesets[0] : season.rulesets;
  const seasonDefinition = (ruleset?.definition ?? {}) as RulesetDefinition;
  const { definition } = await definitionForLeague(admin, league.id, seasonDefinition);

  const roster = await loadRegistrations(admin, league.seasonId, gameweek.number);
  const generated = roster.map((player) => mockStat(`${gameweek.id}:${randomUUID()}`, player.playerId, player.role));
  await writeStats(admin, gameweek.id, generated, "Simulazione admin");

  const stats = new Map(generated.map((stat) => [stat.playerId, stat]));
  const lineups = await loadLineups(admin, gameweek.id, league.participants.map((team) => team.fantasyTeamId));
  let scores;
  try {
    scores = lineups.map((lineup) => scoreLineup(lineup.fantasyTeamId, lineup.slots, stats, definition));
  } catch (error) {
    if (error instanceof ScoreEngineError) throw httpError(error.message, 409);
    throw error;
  }

  await replaceScores(admin, gameweek.id, season.ruleset_id as string, league.participants.map((team) => team.fantasyTeamId), scores);
  await lockLineups(admin, gameweek.id);

  const stamp = new Date().toISOString();
  let statusUpdate = await admin
    .from("gameweeks")
    .update({ status: requestedStatus, scored_at: stamp })
    .eq("id", gameweek.id);
  if (statusUpdate.error && requestedStatus === "scored" && /scored_at/i.test(statusUpdate.error.message)) {
    statusUpdate = await admin.from("gameweeks").update({ status: requestedStatus }).eq("id", gameweek.id);
  }
  if (statusUpdate.error) throw new Error(statusUpdate.error.message);

  const next = requestedStatus === "final"
    ? null
    : await openFollowingGameweek(admin, league.seasonId, gameweek.number);

  const names = new Map(league.participants.map((team) => [team.fantasyTeamId, team.teamName]));
  return {
    leagueId: league.id,
    gameweekId: gameweek.id,
    gameweekNumber: gameweek.number,
    status: requestedStatus,
    nextGameweekNumber: next?.number ?? null,
    ratedPlayers: generated.filter((stat) => stat.voto !== null).length,
    listone: generated.length,
    teamsScored: scores.length,
    scores: scores.map((score) => ({
      fantasyTeamId: score.fantasyTeamId,
      teamName: names.get(score.fantasyTeamId) ?? "Squadra",
      total: score.total,
      playersPoints: score.playersPoints,
      captainModifier: score.captainModifier,
      fairPlay: score.fairPlay,
      defenseModifier: score.defenseModifier,
      reservePoints: score.reservePoints,
    })),
  };
}

async function lockLineups(admin: ReturnType<typeof createAdminSupabase>, gameweekId: string) {
  const { error } = await admin
    .from("lineups")
    .update({ status: "locked", locked_at: new Date().toISOString() })
    .eq("gameweek_id", gameweekId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
}

async function loadGameweek(
  admin: ReturnType<typeof createAdminSupabase>,
  seasonId: string,
  input: { gameweekId?: string; gameweekNumber?: number },
) {
  const query = admin.from("gameweeks").select("id, number, status, season_id").eq("season_id", seasonId);
  const { data, error } = input.gameweekId
    ? await query.eq("id", input.gameweekId).maybeSingle()
    : input.gameweekNumber
      ? await query.eq("number", input.gameweekNumber).maybeSingle()
      : { data: null, error: null };
  if (error) throw new Error(error.message);
  if (!data) throw httpError("Indica gameweekId o gameweekNumber di una giornata della stagione.", 400);
  return data as { id: string; number: number; status: string; season_id: string };
}

async function loadRegistrations(
  admin: ReturnType<typeof createAdminSupabase>,
  seasonId: string,
  gameweekNumber: number,
) {
  const { data, error } = await admin
    .from("player_registrations")
    .select("player_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => {
      const from = row.effective_from_gameweek as number;
      const until = row.effective_to_gameweek as number | null;
      return from <= gameweekNumber && (until === null || until >= gameweekNumber);
    })
    .map((row) => ({ playerId: row.player_id as string, role: row.role as PlayerRole }));
}

async function writeStats(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  generated: PlayerStat[],
  sourceNote: string,
) {
  const importId = randomUUID();
  const payload = JSON.stringify(generated.map((stat) => [stat.playerId, stat.voto, stat.goals, stat.yellowCards]));
  const { error: importError } = await admin.from("vote_imports").insert({
    id: importId,
    gameweek_id: gameweekId,
    source: "mock",
    source_note: sourceNote,
    payload_hash: createHash("sha256").update(payload).digest("hex"),
  });
  if (importError) throw new Error(importError.message);

  const { data: existing, error: existingError } = await admin
    .from("player_gameweek_stats")
    .select("id, player_id")
    .eq("gameweek_id", gameweekId);
  if (existingError) throw new Error(existingError.message);
  const ids = new Map((existing ?? []).map((row) => [row.player_id as string, row.id as string]));

  const rows = generated.map((stat) => ({
    id: ids.get(stat.playerId) ?? randomUUID(),
    gameweek_id: gameweekId,
    player_id: stat.playerId,
    vote_import_id: importId,
    voto: stat.voto,
    goals: stat.goals ?? 0,
    assists: stat.assists ?? 0,
    yellow_cards: stat.yellowCards ?? 0,
    red_cards: stat.redCards ?? 0,
    penalties_scored: stat.penaltiesScored ?? 0,
    penalties_missed: stat.penaltiesMissed ?? 0,
    penalties_saved: stat.penaltiesSaved ?? 0,
    own_goals: stat.ownGoals ?? 0,
    goals_conceded: stat.goalsConceded ?? 0,
  }));

  const { error } = await admin.from("player_gameweek_stats").upsert(rows, { onConflict: "gameweek_id,player_id" });
  if (error) throw new Error(error.message);
}

async function loadLineups(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  teamIds: string[],
) {
  if (teamIds.length === 0) return [];
  const { data, error } = await admin
    .from("lineups")
    .select("id, fantasy_team_id")
    .eq("gameweek_id", gameweekId)
    .in("fantasy_team_id", teamIds);
  if (error) throw new Error(error.message);
  const lineupIds = (data ?? []).map((row) => row.id as string);
  const extended = lineupIds.length
    ? await admin.from("lineup_slots").select("lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order").in("lineup_id", lineupIds)
    : { data: [], error: null };
  const slotsQuery = extended.error && /is_starter|slot_order/i.test(extended.error.message)
    ? await admin.from("lineup_slots").select("lineup_id, player_id, is_captain, is_vice_captain").in("lineup_id", lineupIds)
    : extended;
  if (slotsQuery.error) throw new Error(slotsQuery.error.message);
  const slots = slotsQuery.data ?? [];

  return (data ?? []).map((row) => ({
    fantasyTeamId: row.fantasy_team_id as string,
    slots: slots
      .filter((slot) => slot.lineup_id === row.id)
      .map((slot) => {
        const record = slot as unknown as {
          player_id: string;
          is_captain: boolean;
          is_vice_captain: boolean;
          is_starter?: boolean;
          slot_order?: number;
        };
        return {
          playerId: record.player_id,
          isCaptain: Boolean(record.is_captain) && record.is_starter !== false,
          isVice: Boolean(record.is_vice_captain) && record.is_starter !== false,
          benchOrder: record.is_starter === false ? Number(record.slot_order ?? 0) : undefined,
        };
      }),
  }));
}

async function replaceScores(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  rulesetId: string,
  teamIds: string[],
  scores: TeamScore[],
) {
  if (teamIds.length > 0) {
    const { error } = await admin
      .from("team_gameweek_scores")
      .delete()
      .eq("gameweek_id", gameweekId)
      .in("fantasy_team_id", teamIds);
    if (error) throw new Error(error.message);
  }
  if (scores.length === 0) return;

  const { error: teamError } = await admin.from("team_gameweek_scores").insert(scores.map((score) => ({
    fantasy_team_id: score.fantasyTeamId,
    gameweek_id: gameweekId,
    ruleset_id: rulesetId,
    players_points: score.playersPoints,
    captain_modifier: score.captainModifier,
    captain_player_id: score.captainPlayerId,
    fair_play: score.fairPlay,
    defense_modifier: score.defenseModifier,
    defense_average: score.defenseAverage,
    reserve_points: score.reservePoints,
    total: score.total,
  })));
  if (teamError) throw new Error(teamError.message);

  const playerRows = scores.flatMap((score) => score.players.map((player) => ({
    fantasy_team_id: score.fantasyTeamId,
    gameweek_id: gameweekId,
    player_id: player.playerId,
    voto: player.voto,
    bonus_points: player.bonusPoints,
    malus_points: player.malusPoints,
    malus_factor: player.malusFactor,
    player_points: player.playerPoints,
    is_effective_captain: player.isEffectiveCaptain,
  })));
  if (playerRows.length === 0) return;
  const { error: playerError } = await admin.from("lineup_player_scores").insert(playerRows);
  if (playerError) throw new Error(playerError.message);
}
