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
import { fileForgottenLineups, planForgottenLineups, type OfficeSlot } from "@/lib/server/forgotten-lineup";
import { holeIdsKeepingHeldPlayers, isHeldMatch } from "@/lib/server/held-lineup";
import { playersWithVotesRead } from "@/lib/lineups/votes-read";
import { isOfficialMatchClosed, isSettledGameweek } from "@/lib/server/match-window";
import { loadProvisionalVotes, withProvisionalVotes } from "@/lib/server/provisional-votes";
import { inChunks, readAllChunks, readAllRows } from "@/lib/server/read-all";
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
  /** Formazione d'ufficio non ancora registrata: la mostra la schermata, la salva solo il calcolo. */
  office?: boolean;
};

type RawSlot = {
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
  is_starter?: boolean;
  slot_order?: number;
};

/** Quante squadre insieme nei calcoli: oltre, formazioni e righe da scrivere pesano troppo in memoria. */
const TEAM_BATCH = 1000;
/** Righe scritte per richiesta. */
const WRITE_ROWS = 500;

type LineupRecord = { fantasy_team_id: string; lineup_slots: RawSlot[] | RawSlot | null };

/** Le formazioni di una giornata: di tutte le squadre, o solo di quelle indicate. A pagine in ogni caso. */
async function lineupRecords(admin: ReturnType<typeof createAdminSupabase>, gameweekId: string, teamIds?: string[]) {
  const read = (columns: string) => {
    const base = () => admin.from("lineups").select(columns).eq("gameweek_id", gameweekId);
    return teamIds
      ? readAllChunks<LineupRecord>(teamIds, (ids, from, to) => base().in("fantasy_team_id", ids).order("id").range(from, to).returns<LineupRecord[]>())
      : readAllRows<LineupRecord>((from, to) => base().order("id").range(from, to).returns<LineupRecord[]>());
  };
  const extended = await read("fantasy_team_id, lineup_slots(player_id, is_captain, is_vice_captain, is_starter, slot_order)");
  const rows = extended.error && /is_starter|slot_order/i.test(extended.error.message)
    ? await read("fantasy_team_id, lineup_slots(player_id, is_captain, is_vice_captain)")
    : extended;
  if (rows.error) throw new Error(rows.error.message);
  return rows.data;
}

/**
 * `provisional` aggiunge i voti letti agli orari programmati. Il calcolo ufficiale non lo chiede mai.
 * `office` (solo per le schermate) aggiunge, dopo la chiusura, le formazioni d'ufficio che il calcolo
 * registrerà per chi non ha salvato: stesse regole, nessuna scrittura.
 * `teamIds` limita la lettura a quelle squadre: una schermata di lega non deve leggere tutto il sito.
 */
async function loadContext(gameweekId: string, options?: { provisional?: boolean; office?: boolean; now?: Date; teamIds?: string[] }) {
  const admin = createAdminSupabase();
  const { data: gameweek, error: gameweekError } = await admin
    .from("gameweeks")
    .select("id, number, status, season_id, deadline_at")
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

  const lineupRows = await lineupRecords(admin, gameweekId, options?.teamIds);

  const { data: statRows, error: statError } = await readAllRows((from, to) => admin
    .from("player_gameweek_stats")
    .select("player_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals, goals_conceded")
    .eq("gameweek_id", gameweekId)
    .order("id")
    .range(from, to));
  if (statError) throw new Error(statError.message);

  const { data: registrations, error: registrationError } = await readAllRows((from, to) => admin
    .from("player_registrations")
    .select("player_id, club_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", gameweek.season_id)
    .order("id")
    .range(from, to));
  if (registrationError) throw new Error(registrationError.message);

  const number = gameweek.number as number;
  const roleByPlayer = new Map<string, PlayerRole>();
  const clubByPlayer = new Map<string, string>();
  for (const row of registrations) {
    const from = row.effective_from_gameweek as number;
    const until = row.effective_to_gameweek as number | null;
    if (from > number || (until !== null && until < number)) continue;
    const playerId = row.player_id as string;
    roleByPlayer.set(playerId, row.role as PlayerRole);
    clubByPlayer.set(playerId, row.club_id as string);
  }

  const toInput = (slot: RawSlot | OfficeSlot): LineupSlotInput => ({
    playerId: slot.player_id,
    isCaptain: Boolean(slot.is_captain) && slot.is_starter !== false,
    isVice: Boolean(slot.is_vice_captain) && slot.is_starter !== false,
    role: roleByPlayer.get(slot.player_id),
    benchOrder: slot.is_starter === false ? Number(slot.slot_order ?? 0) : undefined,
  });
  const lineups: LineupRow[] = lineupRows.map((row) => {
    const raw = row.lineup_slots;
    const slots = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    return {
      fantasyTeamId: row.fantasy_team_id,
      slots: slots.map(toInput),
    };
  });
  const closedAt = Date.parse(String(gameweek.deadline_at ?? ""));
  const closed = gameweek.status === "locked" || (Number.isFinite(closedAt) && closedAt <= (options?.now ?? new Date()).getTime());
  if (options?.office && closed && !isSettledGameweek(String(gameweek.status))) {
    const filed = new Set(lineups.map((lineup) => lineup.fantasyTeamId));
    for (const [teamId, slots] of await planForgottenLineups(gameweekId, options.teamIds)) {
      if (filed.has(teamId)) continue;
      lineups.push({ fantasyTeamId: teamId, slots: slots.map(toInput), office: true });
    }
  }

  const stats = new Map<string, PlayerStat>();
  for (const row of statRows) {
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

  if (options?.provisional && !isSettledGameweek(String(gameweek.status))) {
    const merged = withProvisionalVotes(stats, await loadProvisionalVotes(gameweekId), matchFinished, roleByPlayer);
    for (const [playerId, stat] of merged) stats.set(playerId, stat);
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
    clubByPlayer,
  };
}

/** Le colonne di una riga parziale già presente, da riscrivere così com'erano. */
const SCORE_COLUMNS = "fantasy_team_id, gameweek_id, ruleset_id, players_points, captain_modifier, captain_player_id, fair_play, defense_modifier, defense_average, reserve_points, total, is_live";

/** Scrive i parziali a blocchi. Una riga già ufficiale (`is_live` spento) non si tocca. */
async function upsertLiveRows(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  rulesetId: string,
  scores: ProvisionalScore[],
) {
  for (const batch of inChunks(scores)) {
    const found = await admin
      .from("team_gameweek_scores")
      .select(SCORE_COLUMNS)
      .eq("gameweek_id", gameweekId)
      .in("fantasy_team_id", batch.map((score) => score.fantasyTeamId))
      .returns<Record<string, unknown>[]>();
    if (found.error) throw new Error(schemaHint(found.error.message));
    const existing = new Map((found.data ?? []).map((row) => [row.fantasy_team_id as string, row]));
    const rows = batch.flatMap((score) => {
      const current = existing.get(score.fantasyTeamId);
      if (current && current.is_live === false) return [];
      const base = current ?? {
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
      };
      return [{
        ...base,
        provisional_total: score.provisionalTotal,
        rated_players_count: score.ratedPlayersCount,
        on_pitch_count: score.onPitchCount,
        is_live: true,
      }];
    });
    if (rows.length === 0) continue;
    const { error } = await admin.from("team_gameweek_scores").upsert(rows, { onConflict: "fantasy_team_id,gameweek_id" });
    if (error) throw new Error(schemaHint(error.message));
  }
}

/** Le squadre con una formazione nella giornata, divise a gruppi. Senza formazioni, un gruppo vuoto. */
async function teamBatches(gameweekId: string, onlyTeamIds?: string[]) {
  let teamIds = onlyTeamIds;
  if (!teamIds) {
    const admin = createAdminSupabase();
    const filed = await readAllRows((from, to) => admin
      .from("lineups")
      .select("fantasy_team_id")
      .eq("gameweek_id", gameweekId)
      .order("id")
      .range(from, to));
    if (filed.error) throw new Error(filed.error.message);
    teamIds = filed.data.map((row) => row.fantasy_team_id as string);
  }
  return teamIds.length > 0 ? inChunks(teamIds, TEAM_BATCH) : [[]];
}

function liveScoresFor(gameweekId: string, context: Awaited<ReturnType<typeof loadContext>>) {
  return context.lineups.map((lineup) => (
    projectLiveScore(lineup.fantasyTeamId, gameweekId, lineup.slots, context.stats, context.definition)
  ));
}

export async function calculateProvisionalForTeam(fantasyTeamId: string, gameweekId: string) {
  const context = await loadContext(gameweekId, { provisional: true, teamIds: [fantasyTeamId] });
  if (isSettledGameweek(context.gameweek.status)) {
    throw httpError(`La giornata ${context.gameweek.number} è già calcolata: il parziale non la riscrive.`, 409);
  }
  const lineup = context.lineups.find((item) => item.fantasyTeamId === fantasyTeamId);
  if (!lineup) throw httpError("Questa squadra non ha una formazione per la giornata.", 404);
  const score = projectLiveScore(fantasyTeamId, gameweekId, lineup.slots, context.stats, context.definition);
  await upsertLiveRows(context.admin, gameweekId, context.rulesetId, [score]);
  return score;
}

/**
 * Solo lettura, per le schermate: voti provvisori e, dopo la chiusura, formazioni d'ufficio.
 * Una schermata passa in `teamIds` le squadre della sua lega.
 */
export async function previewProvisional(gameweekId: string, now = new Date(), teamIds?: string[]) {
  const context = await loadContext(gameweekId, { provisional: true, office: true, now, teamIds });
  return {
    gameweekNumber: Number(context.gameweek.number),
    definition: context.definition,
    stats: context.stats,
    lineups: context.lineups,
    matchFinished: context.matchFinished,
    votesRead: playersWithVotesRead(context.stats, context.clubByPlayer),
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
  let teams = 0;
  for (const teamIds of await teamBatches(gameweekId)) {
    const context = await loadContext(gameweekId, { provisional: true, teamIds });
    const scores = liveScoresFor(gameweekId, context);
    await upsertLiveRows(context.admin, gameweekId, context.rulesetId, scores);
    teams += scores.length;
  }
  return { gameweekNumber: Number(gate.data.number), teams, skipped: false };
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

  const listed = await admin.from("real_matches").select("status, kickoff_at, postponed, hold_status").eq("gameweek_id", gameweekId);
  const plainListed = listed.error && /postponed|hold_status|schema cache|could not find/i.test(listed.error.message)
    ? await admin.from("real_matches").select("status, kickoff_at").eq("gameweek_id", gameweekId)
    : listed;
  if (plainListed.error) {
    if (!/real_matches|schema cache|could not find/i.test(plainListed.error.message)) throw new Error(plainListed.error.message);
  } else if ((plainListed.data ?? []).some((match) => {
    const row = match as { status?: string; kickoff_at?: string; postponed?: boolean | null; hold_status?: string | null };
    return !isHeldMatch(row) && !isOfficialMatchClosed(String(row.status), String(row.kickoff_at ?? ""), new Date());
  })) {
    return {
      gameweekNumber,
      teams: 0,
      status,
      skipped: true,
      reason: "Ci sono partite ancora aperte.",
    };
  }

  await fileForgottenLineups(gameweekId, options?.teamIds);
  let teams = 0;
  // Se si interrompe a metà la giornata non risulta calcolata: il giro dopo la riscrive tutta.
  for (const batch of await teamBatches(gameweekId, options?.teamIds)) teams += await scoreTeams(gameweekId, batch);
  return {
    gameweekNumber,
    teams,
    status,
    skipped: false,
    reason: null,
  };
}

/** Calcola e registra i punteggi ufficiali di un gruppo di squadre. */
async function scoreTeams(gameweekId: string, batch: string[]) {
  const context = await loadContext(gameweekId, { teamIds: batch });
  const lineupSize = context.definition.lineup_size ?? 11;
  const scores = context.lineups.map((lineup) => (
    scoreLineup(
      lineup.fantasyTeamId,
      lineup.slots,
      context.stats,
      context.definition,
      holeIdsKeepingHeldPlayers(lineup.slots, context.stats, lineupSize),
    )
  ));
  for (const part of inChunks(scores, WRITE_ROWS)) {
    const { error } = await context.admin
      .from("team_gameweek_scores")
      .upsert(part.map((score) => officialRow(gameweekId, context.rulesetId, score)), {
        onConflict: "fantasy_team_id,gameweek_id",
      });
    if (error) throw new Error(schemaHint(error.message));
  }
  for (const part of inChunks(scores)) {
    const cleared = await context.admin
      .from("lineup_player_scores")
      .delete()
      .eq("gameweek_id", gameweekId)
      .in("fantasy_team_id", part.map((score) => score.fantasyTeamId));
    if (cleared.error) throw new Error(cleared.error.message);
    // Le righe nuove subito dopo la cancellazione dello stesso blocco: il vuoto dura pochissimo.
    const playerRows = part.flatMap((score) => score.players.map((player) => ({
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
    for (const rows of inChunks(playerRows, WRITE_ROWS)) {
      const { error } = await context.admin.from("lineup_player_scores").insert(rows);
      if (error) throw new Error(error.message);
    }
  }
  return scores.length;
}

export function newId() {
  return randomUUID();
}
