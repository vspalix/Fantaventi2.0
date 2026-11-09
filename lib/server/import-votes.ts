import { randomUUID } from "node:crypto";
import { resolveVotesAdapter, sourcePayloadHash } from "@/lib/adapters";
import type { AdapterSource } from "@/lib/adapters";
import { refreshProvisionalScores, schemaHint, scoreOfficialGameweek } from "@/lib/server/live-score";
import { createAdminSupabase } from "@/lib/supabase/admin";

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export async function importVotes(
  userId: string,
  input: { gameweekId: string; provider?: string; source: AdapterSource; replace?: boolean; superAdmin?: boolean },
) {
  const admin = createAdminSupabase();
  const { data: gameweek, error: gameweekError } = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .eq("id", input.gameweekId)
    .maybeSingle();
  if (gameweekError) throw new Error(gameweekError.message);
  if (!gameweek) throw httpError("Giornata non trovata.", 404);
  if (gameweek.status === "final") {
    throw httpError(`La giornata ${gameweek.number} è final: i voti non si modificano.`, 409);
  }

  if (!input.superAdmin) {
    const { data: owned, error: ownedError } = await admin
      .from("private_leagues")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("season_id", gameweek.season_id)
      .limit(1);
    if (ownedError) throw new Error(ownedError.message);
    if (!owned?.length) throw httpError("Solo il proprietario di una lega di questa stagione può importare i voti.", 403);
  }

  const adapter = resolveVotesAdapter(input.provider);
  const feed = await adapter.parse(input.source);
  if (feed.votes.length === 0) {
    throw httpError("Il provider non ha restituito voti da scrivere.", 400);
  }
  const payloadHash = sourcePayloadHash(input.source, feed);
  const { data: duplicate, error: duplicateError } = await admin
    .from("vote_imports")
    .select("id")
    .eq("gameweek_id", input.gameweekId)
    .eq("payload_hash", payloadHash)
    .maybeSingle();
  if (duplicateError) throw new Error(duplicateError.message);
  if (duplicate && !input.replace) throw httpError("Questa fonte è già stata importata per la giornata.", 409);
  if (duplicate && input.replace) {
    const cleared = await admin
      .from("player_gameweek_stats")
      .delete()
      .eq("vote_import_id", duplicate.id);
    if (cleared.error) throw new Error(schemaHint(cleared.error.message));
    const { error: clearError } = await admin.from("vote_imports").delete().eq("id", duplicate.id);
    if (clearError) throw new Error(schemaHint(clearError.message));
  }

  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("competition_id")
    .eq("id", gameweek.season_id)
    .maybeSingle();
  if (seasonError) throw new Error(seasonError.message);
  if (!season?.competition_id) throw httpError("La stagione della giornata non ha una competizione.", 409);

  const codes = feed.votes.map((row) => row.externalRef);
  const { data: players, error: playerError } = await admin
    .from("players")
    .select("id, external_ref")
    .eq("competition_id", season.competition_id)
    .in("external_ref", codes);
  if (playerError) {
    if (/competition_id/i.test(playerError.message)) {
      throw httpError("Esegui multi_competition.sql: il codice calciatore deve essere unico dentro la competizione.", 409);
    }
    throw new Error(playerError.message);
  }
  const playerIds = new Map((players ?? []).map((player) => [player.external_ref as string, player.id as string]));
  const known = feed.votes.filter((row) => playerIds.has(row.externalRef));
  const unknown = feed.votes.length - known.length;
  if (known.length === 0) {
    throw httpError("Nessun codice del provider è nel listone. Importa prima i calciatori.", 400);
  }

  const importId = randomUUID();
  const { error: importError } = await admin.from("vote_imports").insert({
    id: importId,
    gameweek_id: input.gameweekId,
    source: adapter.id,
    source_note: input.source.fileName || adapter.label,
    payload_hash: payloadHash,
  });
  if (importError) {
    if (/vote_imports_gameweek_payload_uidx|duplicate key/i.test(importError.message)) {
      throw httpError("Questo file è già stato importato per la giornata.", 409);
    }
    throw new Error(schemaHint(importError.message));
  }

  const ids = known.map((row) => playerIds.get(row.externalRef) as string);
  const { data: existing, error: existingError } = await admin
    .from("player_gameweek_stats")
    .select("id, player_id")
    .eq("gameweek_id", input.gameweekId)
    .in("player_id", ids);
  if (existingError) throw new Error(existingError.message);
  const statIds = new Map((existing ?? []).map((row) => [row.player_id as string, row.id as string]));

  const { error: statError } = await admin.from("player_gameweek_stats").upsert(known.map((row) => {
    const playerId = playerIds.get(row.externalRef) as string;
    return {
      id: statIds.get(playerId) ?? randomUUID(),
      gameweek_id: input.gameweekId,
      player_id: playerId,
      vote_import_id: importId,
      voto: row.postponed && row.voto === 0 ? null : row.voto,
      goals: row.goals,
      assists: row.assists,
      yellow_cards: row.yellowCards,
      red_cards: row.redCards,
      penalties_scored: row.penaltiesScored,
      penalties_missed: row.penaltiesMissed,
      penalties_saved: row.penaltiesSaved,
      own_goals: row.ownGoals,
      goals_conceded: row.goalsConceded,
      postponed: Boolean(row.postponed),
    };
  }), { onConflict: "gameweek_id,player_id" });
  if (statError && /postponed/i.test(statError.message)) {
    const { error: retryError } = await admin.from("player_gameweek_stats").upsert(known.map((row) => {
      const playerId = playerIds.get(row.externalRef) as string;
      return {
        id: statIds.get(playerId) ?? randomUUID(),
        gameweek_id: input.gameweekId,
        player_id: playerId,
        vote_import_id: importId,
        voto: row.postponed && row.voto === 0 ? null : row.voto,
        goals: row.goals,
        assists: row.assists,
        yellow_cards: row.yellowCards,
        red_cards: row.redCards,
        penalties_scored: row.penaltiesScored,
        penalties_missed: row.penaltiesMissed,
        penalties_saved: row.penaltiesSaved,
        own_goals: row.ownGoals,
        goals_conceded: row.goalsConceded,
      };
    }), { onConflict: "gameweek_id,player_id" });
    if (retryError) throw new Error(schemaHint(retryError.message));
  } else if (statError) throw new Error(schemaHint(statError.message));

  const provisional = await refreshProvisionalScores(input.gameweekId);
  let official: { teams: number; skipped: boolean } | null = null;
  if (gameweek.status === "scored") {
    official = await scoreOfficialGameweek(input.gameweekId, { allowRewrite: true });
  }

  return {
    gameweekNumber: gameweek.number as number,
    payloadHash,
    rated: known.length,
    provider: adapter.id,
    skippedWithoutVote: feed.skippedWithoutVote,
    unknown,
    provisionalTeams: provisional.teams,
    officialRecalculated: Boolean(official && !official.skipped),
  };
}
