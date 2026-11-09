import { randomUUID } from "node:crypto";
import {
  projectLiveScore,
  scoreLineup,
  type LineupSlotInput,
  type PlayerStat,
  type ProvisionalScore,
  type RulesetDefinition,
  type TeamScore,
} from "@/lib/engine/calculator";
import { fileForgottenLineups } from "@/lib/server/forgotten-lineup";
import { isOfficialMatchClosed, isSettledGameweek } from "@/lib/server/match-window";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function schemaHint(message: string) {
  if (/provisional_total|is_live|on_pitch_count|rated_players_count|real_matches|scored_at|column/i.test(message)) {
    return "Esegui production_architecture.sql nell'editor SQL di Supabase e riprova.";
  }
  return message;
}

type LineupRow = {
  fantasyTeamId: string;
  slots: LineupSlotInput[];
};

type RawSlot = {
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
  is_starter?: boolean;
  slot_order?: number;
};

async function loadContext(gameweekId: string) {
  const admin = createAdminSupabase();
  const { data: gameweek, error: gameweekError } = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .eq("id", gameweekId)
    .maybeSingle();
  if (gameweekError) throw new Error(gameweekError.message);
  if (!gameweek) throw httpError("Giornata non trovata.", 404);
  if (gameweek.status === "final") {
    throw httpError(`La giornata ${gameweek.number} è final e non si ricalcola.`, 409);
  }

  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("ruleset_id, rulesets(definition)")
    .eq("id", gameweek.season_id)
    .single();
  if (seasonError) throw new Error(seasonError.message);
  const ruleset = Array.isArray(season.rulesets) ? season.rulesets[0] : season.rulesets;
  const definition = (ruleset?.definition ?? {}) as RulesetDefinition;

  const extended = await admin
    .from("lineups")
    .select("fantasy_team_id, lineup_slots(player_id, is_captain, is_vice_captain, is_starter, slot_order)")
    .eq("gameweek_id", gameweekId);
  const lineupQuery = extended.error && /is_starter|slot_order/i.test(extended.error.message)
    ? await admin
      .from("lineups")
      .select("fantasy_team_id, lineup_slots(player_id, is_captain, is_vice_captain)")
      .eq("gameweek_id", gameweekId)
    : extended;
  if (lineupQuery.error) throw new Error(lineupQuery.error.message);
  const lineupRows = lineupQuery.data;

  const { data: statRows, error: statError } = await admin
    .from("player_gameweek_stats")
    .select("player_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals, goals_conceded")
    .eq("gameweek_id", gameweekId);
  if (statError) throw new Error(statError.message);

  const { data: registrations, error: registrationError } = await admin
    .from("player_registrations")
    .select("player_id, club_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", gameweek.season_id);
  if (registrationError) throw new Error(registrationError.message);

  const number = gameweek.number as number;
  const roleByPlayer = new Map<string, PlayerRole>();
  const clubByPlayer = new Map<string, string>();
  for (const row of registrations ?? []) {
    const from = row.effective_from_gameweek as number;
    const until = row.effective_to_gameweek as number | null;
    if (from > number || (until !== null && until < number)) continue;
    const playerId = row.player_id as string;
    roleByPlayer.set(playerId, row.role as PlayerRole);
    clubByPlayer.set(playerId, row.club_id as string);
  }

  const lineups: LineupRow[] = (lineupRows ?? []).map((row) => {
    const raw = row.lineup_slots as RawSlot[] | RawSlot | null;
    const slots = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    return {
      fantasyTeamId: row.fantasy_team_id as string,
      slots: slots.map((slot) => ({
        playerId: slot.player_id,
        isCaptain: Boolean(slot.is_captain) && slot.is_starter !== false,
        isVice: Boolean(slot.is_vice_captain) && slot.is_starter !== false,
        role: roleByPlayer.get(slot.player_id),
        benchOrder: slot.is_starter === false ? Number(slot.slot_order ?? 0) : undefined,
      })),
    };
  });

  const stats = new Map<string, PlayerStat>();
  for (const row of statRows ?? []) {
    const playerId = row.player_id as string;
    stats.set(playerId, {
      playerId,
      role: roleByPlayer.get(playerId) ?? "MID",
      voto: row.voto === null || row.voto === undefined ? null : Number(row.voto),
      goals: Number(row.goals ?? 0),
      assists: Number(row.assists ?? 0),
      yellowCards: Number(row.yellow_cards ?? 0),
      redCards: Number(row.red_cards ?? 0),
      penaltiesScored: Number(row.penalties_scored ?? 0),
      penaltiesMissed: Number(row.penalties_missed ?? 0),
      penaltiesSaved: Number(row.penalties_saved ?? 0),
      ownGoals: Number(row.own_goals ?? 0),
      goalsConceded: Number(row.goals_conceded ?? 0),
    });
  }

  const matches = await admin
    .from("real_matches")
    .select("home_club_id, away_club_id, status")
    .eq("gameweek_id", gameweekId);
  const finishedClubs = new Set<string>();
  if (!matches.error) {
    for (const match of matches.data ?? []) {
      if (match.status !== "finished") continue;
      finishedClubs.add(match.home_club_id as string);
      finishedClubs.add(match.away_club_id as string);
    }
  } else if (!/real_matches|schema cache|could not find/i.test(matches.error.message)) {
    throw new Error(matches.error.message);
  }

  const matchFinished = new Set<string>();
  for (const [playerId, clubId] of clubByPlayer) {
    if (finishedClubs.has(clubId)) matchFinished.add(playerId);
  }

  const postponed = await admin
    .from("real_matches")
    .select("home_club_id, away_club_id")
    .eq("gameweek_id", gameweekId)
    .eq("postponed", true);
  if (!postponed.error) {
    const clubs = new Set((postponed.data ?? []).flatMap((match) => [match.home_club_id as string, match.away_club_id as string]));
    for (const [playerId, clubId] of clubByPlayer) {
      if (!clubs.has(clubId)) continue;
      const current = stats.get(playerId);
      stats.set(playerId, {
        playerId,
        role: current?.role ?? roleByPlayer.get(playerId) ?? "MID",
        voto: null,
        goals: 0,
        assists: 0,
        yellowCards: 0,
        redCards: 0,
        penaltiesScored: 0,
        penaltiesMissed: 0,
        penaltiesSaved: 0,
        ownGoals: 0,
        goalsConceded: 0,
        postponed: true,
      });
    }
  }

  return {
    admin,
    gameweek: {
      id: gameweek.id as string,
      number,
      status: gameweek.status as string,
      seasonId: gameweek.season_id as string,
    },
    rulesetId: season.ruleset_id as string,
    definition,
    lineups,
    stats,
    matchFinished,
  };
}

async function upsertLiveRow(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  rulesetId: string,
  score: ProvisionalScore,
) {
  const { data: existing, error: existingError } = await admin
    .from("team_gameweek_scores")
    .select("fantasy_team_id, is_live")
    .eq("gameweek_id", gameweekId)
    .eq("fantasy_team_id", score.fantasyTeamId)
    .maybeSingle();
  if (existingError) throw new Error(schemaHint(existingError.message));

  const live = {
    provisional_total: score.provisionalTotal,
    rated_players_count: score.ratedPlayersCount,
    on_pitch_count: score.onPitchCount,
    is_live: true,
  };

  if (existing) {
    if (existing.is_live === false) return;
    const { error } = await admin
      .from("team_gameweek_scores")
      .update(live)
      .eq("gameweek_id", gameweekId)
      .eq("fantasy_team_id", score.fantasyTeamId);
    if (error) throw new Error(schemaHint(error.message));
    return;
  }

  const { error } = await admin.from("team_gameweek_scores").insert({
    fantasy_team_id: score.fantasyTeamId,
    gameweek_id: gameweekId,
    ruleset_id: rulesetId,
    players_points: 0,
    captain_modifier: 0,
    captain_player_id: null,
    fair_play: 0,
    defense_modifier: 0,
    defense_average: null,
    reserve_points: 0,
    total: 0,
    ...live,
  });
  if (error) throw new Error(schemaHint(error.message));
}

function liveScoresFor(
  gameweekId: string,
  context: Awaited<ReturnType<typeof loadContext>>,
  overlay?: Map<string, PlayerStat>,
) {
  return context.lineups.map((lineup) => {
    const stats = new Map(context.stats);
    if (overlay) {
      for (const [id, stat] of overlay) {
        const current = stats.get(id);
        stats.set(id, { ...stat, role: current?.role ?? stat.role });
      }
    }
    return projectLiveScore(lineup.fantasyTeamId, gameweekId, lineup.slots, stats, context.definition);
  });
}

export async function calculateProvisionalForTeam(fantasyTeamId: string, gameweekId: string) {
  const context = await loadContext(gameweekId);
  if (isSettledGameweek(context.gameweek.status)) {
    throw httpError(`La giornata ${context.gameweek.number} è già calcolata: il parziale non la riscrive.`, 409);
  }
  const lineup = context.lineups.find((item) => item.fantasyTeamId === fantasyTeamId);
  if (!lineup) throw httpError("Questa squadra non ha una formazione per la giornata.", 404);
  const score = projectLiveScore(fantasyTeamId, gameweekId, lineup.slots, context.stats, context.definition);
  await upsertLiveRow(context.admin, gameweekId, context.rulesetId, score);
  return score;
}

export async function previewProvisional(gameweekId: string) {
  const context = await loadContext(gameweekId);
  return {
    definition: context.definition,
    stats: context.stats,
    lineups: context.lineups,
    matchFinished: context.matchFinished,
    scores: liveScoresFor(gameweekId, context),
  };
}

export async function refreshProvisionalScores(gameweekId: string) {
  const admin = createAdminSupabase();
  const gate = await admin.from("gameweeks").select("number, status").eq("id", gameweekId).maybeSingle();
  if (gate.error) throw new Error(gate.error.message);
  if (!gate.data) throw httpError("Giornata non trovata.", 404);
  if (isSettledGameweek(String(gate.data.status))) {
    return { gameweekNumber: Number(gate.data.number), teams: 0, skipped: true };
  }
  const context = await loadContext(gameweekId);
  const scores = liveScoresFor(gameweekId, context);
  for (const score of scores) {
    await upsertLiveRow(context.admin, gameweekId, context.rulesetId, score);
  }
  return { gameweekNumber: context.gameweek.number, teams: scores.length, skipped: false };
}

export async function persistLiveProjection(gameweekId: string, overlay: Map<string, PlayerStat>) {
  const admin = createAdminSupabase();
  const gate = await admin.from("gameweeks").select("number, status").eq("id", gameweekId).maybeSingle();
  if (gate.error) throw new Error(gate.error.message);
  if (!gate.data || isSettledGameweek(String(gate.data.status))) {
    return { gameweekNumber: Number(gate.data?.number ?? 0), teams: 0, skipped: true };
  }
  const context = await loadContext(gameweekId);
  const scores = liveScoresFor(gameweekId, context, overlay);
  for (const score of scores) {
    await upsertLiveRow(context.admin, gameweekId, context.rulesetId, score);
  }
  return { gameweekNumber: context.gameweek.number, teams: scores.length, skipped: false };
}

function officialRow(gameweekId: string, rulesetId: string, score: TeamScore) {
  const rated = score.players.filter((player) => player.voto !== null).length;
  return {
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
    provisional_total: score.total,
    rated_players_count: rated,
    on_pitch_count: 0,
    is_live: false,
  };
}

export async function scoreOfficialGameweek(
  gameweekId: string,
  options?: { allowRewrite?: boolean; teamIds?: string[] },
) {
  const admin = createAdminSupabase();
  const gate = await admin.from("gameweeks").select("id, number, status").eq("id", gameweekId).maybeSingle();
  if (gate.error) throw new Error(gate.error.message);
  if (!gate.data) throw httpError("Giornata non trovata.", 404);
  const status = String(gate.data.status);
  const gameweekNumber = Number(gate.data.number);
  if (!options?.allowRewrite && isSettledGameweek(status)) {
    return {
      gameweekNumber,
      teams: 0,
      status,
      skipped: true,
      reason: "Giornata già calcolata.",
    };
  }

  const listed = await admin.from("real_matches").select("status, kickoff_at").eq("gameweek_id", gameweekId);
  if (listed.error) {
    if (!/real_matches|schema cache|could not find/i.test(listed.error.message)) throw new Error(listed.error.message);
  } else if ((listed.data ?? []).some((match) => !isOfficialMatchClosed(String(match.status), String(match.kickoff_at ?? ""), new Date()))) {
    return {
      gameweekNumber,
      teams: 0,
      status,
      skipped: true,
      reason: "Ci sono partite ancora aperte.",
    };
  }

  await fileForgottenLineups(gameweekId, options?.teamIds);
  const context = await loadContext(gameweekId);
  const limited = options?.teamIds ? new Set(options.teamIds) : null;
  const scores = context.lineups
    .filter((lineup) => !limited || limited.has(lineup.fantasyTeamId))
    .map((lineup) => (
      scoreLineup(lineup.fantasyTeamId, lineup.slots, context.stats, context.definition)
    ));
  const teamIds = scores.map((score) => score.fantasyTeamId);
  if (scores.length > 0) {
    const { error } = await context.admin
      .from("team_gameweek_scores")
      .upsert(scores.map((score) => officialRow(gameweekId, context.rulesetId, score)), {
        onConflict: "fantasy_team_id,gameweek_id",
      });
    if (error) throw new Error(schemaHint(error.message));
    const cleared = await context.admin
      .from("lineup_player_scores")
      .delete()
      .eq("gameweek_id", gameweekId)
      .in("fantasy_team_id", teamIds);
    if (cleared.error) throw new Error(cleared.error.message);
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
    if (playerRows.length > 0) {
      const { error: playerError } = await context.admin.from("lineup_player_scores").insert(playerRows);
      if (playerError) throw new Error(playerError.message);
    }
  }
  return {
    gameweekNumber: context.gameweek.number,
    teams: scores.length,
    status: context.gameweek.status,
    skipped: false,
    reason: null,
  };
}

export function newId() {
  return randomUUID();
}
