import { createHash, randomUUID } from "node:crypto";
import { EmergencyVoteError, parseEmergencyVotes } from "@/lib/adapters/emergency-votes";
import { schemaHint, scoreOfficialGameweek } from "@/lib/server/live-score";
import { createAdminSupabase } from "@/lib/supabase/admin";

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export async function importEmergencyVotes(gameweekId: string, fileName: string, text: string) {
  let feed;
  try {
    feed = parseEmergencyVotes(text, fileName);
  } catch (error) {
    if (error instanceof EmergencyVoteError) throw httpError(error.message, 400);
    throw error;
  }

  const admin = createAdminSupabase();
  const week = await admin.from("gameweeks").select("id, number, status, season_id").eq("id", gameweekId).maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) throw httpError("Giornata non trovata.", 404);
  if (week.data.status === "final") throw httpError(`La giornata ${week.data.number} è final: i voti non si modificano.`, 409);

  const season = await admin.from("seasons").select("competition_id").eq("id", week.data.season_id as string).maybeSingle();
  if (season.error) throw new Error(season.error.message);
  if (!season.data?.competition_id) throw httpError("La stagione della giornata non ha una competizione.", 409);

  const codes = feed.votes.map((row) => row.externalRef);
  const players = await admin.from("players").select("id, external_ref").eq("competition_id", season.data.competition_id as string).in("external_ref", codes);
  if (players.error) throw new Error(players.error.message);
  const playerIds = new Map((players.data ?? []).map((row) => [row.external_ref as string, row.id as string]));
  const missing = feed.votes.filter((row) => !playerIds.has(row.externalRef)).map((row) => row.externalRef);
  if (missing.length > 0) {
    throw httpError(`Codici assenti dal listone: ${missing.slice(0, 8).join(", ")}. Nessun voto salvato.`, 400);
  }

  const payloadHash = createHash("sha256").update(text).digest("hex");
  const importId = randomUUID();
  const created = await admin.from("vote_imports").insert({
    id: importId,
    gameweek_id: gameweekId,
    source: "emergency-file",
    source_note: fileName || "emergenza",
    payload_hash: payloadHash,
  });
  if (created.error && /duplicate key|vote_imports_gameweek_payload_uidx/i.test(created.error.message)) {
    const previous = await admin.from("vote_imports").select("id").eq("gameweek_id", gameweekId).eq("payload_hash", payloadHash).maybeSingle();
    if (previous.error) throw new Error(previous.error.message);
    if (previous.data?.id) {
      await admin.from("player_gameweek_stats").delete().eq("vote_import_id", previous.data.id as string);
      await admin.from("vote_imports").delete().eq("id", previous.data.id as string);
    }
    const retry = await admin.from("vote_imports").insert({
      id: importId,
      gameweek_id: gameweekId,
      source: "emergency-file",
      source_note: fileName || "emergenza",
      payload_hash: payloadHash,
    });
    if (retry.error) throw new Error(schemaHint(retry.error.message));
  } else if (created.error) {
    throw new Error(schemaHint(created.error.message));
  }

  const ids = feed.votes.map((row) => playerIds.get(row.externalRef) as string);
  const existing = await admin.from("player_gameweek_stats").select("id, player_id").eq("gameweek_id", gameweekId).in("player_id", ids);
  if (existing.error) {
    await admin.from("vote_imports").delete().eq("id", importId);
    throw new Error(existing.error.message);
  }
  const statIds = new Map((existing.data ?? []).map((row) => [row.player_id as string, row.id as string]));
  const saved = await admin.from("player_gameweek_stats").upsert(feed.votes.map((row) => {
    const playerId = playerIds.get(row.externalRef) as string;
    return {
      id: statIds.get(playerId) ?? randomUUID(),
      gameweek_id: gameweekId,
      player_id: playerId,
      vote_import_id: importId,
      voto: row.voto,
      goals: row.goals,
      assists: row.assists,
      yellow_cards: row.yellowCards,
      red_cards: row.redCards,
      penalties_scored: row.penaltiesScored,
      penalties_missed: row.penaltiesMissed,
      penalties_saved: row.penaltiesSaved,
      own_goals: row.ownGoals,
      goals_conceded: row.goalsConceded,
      postponed: row.postponed,
    };
  }), { onConflict: "gameweek_id,player_id" });
  if (saved.error) {
    await admin.from("vote_imports").delete().eq("id", importId);
    if (/postponed/i.test(saved.error.message)) {
      throw httpError("Per i rinvii esegui lo schema che aggiunge postponed. Nessun voto è rimasto a metà.", 409);
    }
    throw new Error(schemaHint(saved.error.message));
  }

  const closed = await admin.from("real_matches").update({ status: "finished" }).eq("gameweek_id", gameweekId);
  if (closed.error && !/real_matches|schema cache|could not find/i.test(closed.error.message)) {
    throw new Error(closed.error.message);
  }
  const official = await scoreOfficialGameweek(gameweekId, { allowRewrite: week.data.status === "scored" });
  if (!official.skipped && week.data.status !== "scored" && week.data.status !== "final") {
    const stamp = new Date().toISOString();
    const statusUpdate = await admin.from("gameweeks").update({ status: "scored", scored_at: stamp }).eq("id", gameweekId);
    if (statusUpdate.error && /scored_at/i.test(statusUpdate.error.message)) {
      await admin.from("gameweeks").update({ status: "scored" }).eq("id", gameweekId);
    }
  }
  return {
    gameweekNumber: week.data.number as number,
    rated: feed.votes.length,
    payloadHash,
    officialTeams: official.teams,
    officialSkipped: official.skipped,
    reason: official.reason ?? null,
  };
}
