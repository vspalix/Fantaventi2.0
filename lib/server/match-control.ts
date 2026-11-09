import { processGameweekLifecycle } from "@/lib/server/gameweek-lifecycle";
import { getLeagueDetail } from "@/lib/server/leagues";
import { schemaHint, scoreOfficialGameweek } from "@/lib/server/live-score";
import { rebuildWeekBoard } from "@/lib/server/engagement-tick";
import { ensureMockVotes } from "@/lib/server/simulate-gameweek";
import { createAdminSupabase } from "@/lib/supabase/admin";

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

async function ownedGameweek(
  userId: string,
  leagueId: string,
  gameweekId: string,
  options?: { allowFinal?: boolean },
) {
  const league = await getLeagueDetail(userId, leagueId);
  if (!league.isOwner && !league.platformOverride) {
    throw httpError("Solo chi ha creato la lega può gestire le partite.", 403);
  }
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .eq("id", gameweekId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.season_id !== league.seasonId) {
    throw httpError("La giornata non appartiene alla stagione della lega.", 404);
  }
  if (!options?.allowFinal && data.status === "final") {
    throw httpError(`La giornata ${data.number} è final e non si riscrive.`, 409);
  }
  return { admin, league, gameweek: data as { id: string; number: number; status: string; season_id: string } };
}

export async function finishGameweekMatches(userId: string, input: { leagueId: string; gameweekId: string }) {
  const { admin, league, gameweek } = await ownedGameweek(userId, input.leagueId, input.gameweekId);
  const listed = await admin.from("real_matches").select("id").eq("gameweek_id", gameweek.id);
  if (listed.error) throw new Error(schemaHint(listed.error.message));
  if ((listed.data ?? []).length === 0) {
    throw httpError("Questa giornata non ha partite. Importa il calendario della competizione.", 409);
  }

  const { error: finishError } = await admin
    .from("real_matches")
    .update({ status: "finished" })
    .eq("gameweek_id", gameweek.id);
  if (finishError) throw new Error(schemaHint(finishError.message));

  if (gameweek.status === "scored") {
    return {
      gameweekNumber: gameweek.number,
      matches: listed.data?.length ?? 0,
      alreadyScored: true,
      scored: false,
      testVotes: false,
      rated: 0,
    };
  }

  if (gameweek.status === "scheduled" || gameweek.status === "open") {
    const stamp = new Date().toISOString();
    const { error: statusError } = await admin.from("gameweeks").update({ status: "locked" }).eq("id", gameweek.id);
    if (statusError) throw new Error(schemaHint(statusError.message));
    const { error: lineupError } = await admin
      .from("lineups")
      .update({ status: "locked", locked_at: stamp })
      .eq("gameweek_id", gameweek.id)
      .eq("status", "draft");
    if (lineupError) throw new Error(lineupError.message);
  }

  const votes = await ensureMockVotes(admin, league.seasonId, gameweek);
  const lifecycle = await processGameweekLifecycle(new Date(), { finalize: false });
  return {
    gameweekNumber: gameweek.number,
    matches: listed.data?.length ?? 0,
    alreadyScored: false,
    scored: lifecycle.scored.includes(gameweek.number),
    testVotes: votes.created,
    rated: votes.rated,
    skipped: lifecycle.skipped.find((item) => item.number === gameweek.number)?.reason ?? null,
  };
}

export async function resetGameweekCalculation(userId: string, input: { leagueId: string; gameweekId: string }) {
  const { admin, gameweek } = await ownedGameweek(userId, input.leagueId, input.gameweekId, { allowFinal: true });
  const reopen = gameweek.status === "scored" || gameweek.status === "final";
  if (reopen) {
    let statusUpdate = await admin
      .from("gameweeks")
      .update({ status: "locked", scored_at: null })
      .eq("id", gameweek.id);
    if (statusUpdate.error && /scored_at/i.test(statusUpdate.error.message)) {
      statusUpdate = await admin.from("gameweeks").update({ status: "locked" }).eq("id", gameweek.id);
    }
    if (statusUpdate.error) {
      if (/final/i.test(statusUpdate.error.message)) {
        throw httpError("Per annullare una giornata final esegui schema_sync.sql e riprova.", 409);
      }
      throw new Error(schemaHint(statusUpdate.error.message));
    }
  }

  const removed = await admin
    .from("team_gameweek_scores")
    .delete()
    .eq("gameweek_id", gameweek.id)
    .select("fantasy_team_id");
  if (removed.error) throw new Error(schemaHint(removed.error.message));

  const clearVotes = reopen || (removed.data?.length ?? 0) > 0;
  let votesCleared = 0;
  if (clearVotes) {
    const stats = await admin.from("player_gameweek_stats").delete().eq("gameweek_id", gameweek.id).select("id");
    if (stats.error) throw new Error(schemaHint(stats.error.message));
    const imports = await admin.from("vote_imports").delete().eq("gameweek_id", gameweek.id).select("id");
    if (imports.error) throw new Error(schemaHint(imports.error.message));
    votesCleared = imports.data?.length ?? 0;
  }

  return {
    gameweekNumber: gameweek.number,
    scoresCleared: removed.data?.length ?? 0,
    votesCleared,
    status: reopen ? "locked" : gameweek.status,
  };
}

export async function calculateImportedGameweek(userId: string, input: { leagueId: string; gameweekId: string }) {
  const { admin, gameweek } = await ownedGameweek(userId, input.leagueId, input.gameweekId);
  if (gameweek.status === "scored" || gameweek.status === "final") {
    return {
      gameweekNumber: gameweek.number,
      teams: 0,
      status: gameweek.status as "scored" | "final",
      skipped: true,
    };
  }
  const imports = await admin
    .from("vote_imports")
    .select("id", { count: "exact", head: true })
    .eq("gameweek_id", gameweek.id);
  if (imports.error) throw new Error(schemaHint(imports.error.message));
  if ((imports.count ?? 0) === 0) {
    throw httpError("Carica prima i voti ufficiali di questa giornata.", 409);
  }

  const matches = await admin.from("real_matches").select("status").eq("gameweek_id", gameweek.id);
  if (matches.error) throw new Error(schemaHint(matches.error.message));
  const rows = matches.data ?? [];
  if (rows.length === 0) throw httpError("Questa giornata non ha partite. Importa il calendario della competizione.", 409);
  if (rows.some((match) => match.status !== "finished")) {
    throw httpError("Segna prima tutte le partite come finite.", 409);
  }

  const scored = await scoreOfficialGameweek(gameweek.id);
  const stamp = new Date().toISOString();
  let statusUpdate = await admin
    .from("gameweeks")
    .update({ status: "scored", scored_at: stamp })
    .eq("id", gameweek.id);
  if (statusUpdate.error && /scored_at/i.test(statusUpdate.error.message)) {
    statusUpdate = await admin.from("gameweeks").update({ status: "scored" }).eq("id", gameweek.id);
  }
  if (statusUpdate.error) throw new Error(schemaHint(statusUpdate.error.message));
  const { error: lineupError } = await admin
    .from("lineups")
    .update({ status: "locked", locked_at: stamp })
    .eq("gameweek_id", gameweek.id)
    .eq("status", "draft");
  if (lineupError) throw new Error(lineupError.message);

  return {
    gameweekNumber: gameweek.number,
    teams: scored.teams,
    status: "scored" as const,
    skipped: scored.skipped,
  };
}

export async function setMatchPostponed(matchId: string, postponed: boolean) {
  const admin = createAdminSupabase();
  const match = await admin
    .from("real_matches")
    .select("id, status, gameweek_id")
    .eq("id", matchId)
    .maybeSingle();
  if (match.error) throw new Error(match.error.message);
  if (!match.data) throw httpError("Partita non trovata.", 404);
  if (postponed && match.data.status === "finished") {
    throw httpError("Una partita già chiusa non si segna come rinviata. Correggi i voti con il ricalcolo straordinario.", 409);
  }
  const updated = await admin.from("real_matches").update({ postponed }).eq("id", matchId);
  if (updated.error) {
    if (/postponed|schema cache|could not find/i.test(updated.error.message)) {
      throw httpError("Manca la colonna postponed. Esegui match_postponed.sql.", 409);
    }
    throw new Error(updated.error.message);
  }
  return {
    matchId,
    gameweekId: match.data.gameweek_id as string,
    postponed,
  };
}

export async function recalculateExtraordinary(gameweekId: string) {
  const admin = createAdminSupabase();
  const week = await admin.from("gameweeks").select("id, number, status").eq("id", gameweekId).maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) throw httpError("Giornata non trovata.", 404);
  if (week.data.status === "final") {
    throw httpError(`La giornata ${week.data.number} è final e non si ricalcola.`, 409);
  }
  if (week.data.status !== "scored") {
    throw httpError("Il ricalcolo straordinario vale su una giornata già calcolata.", 409);
  }
  const scored = await scoreOfficialGameweek(gameweekId, { allowRewrite: true });
  let board = 0;
  try {
    board = await rebuildWeekBoard(gameweekId);
  } catch {
    board = 0;
  }
  return {
    gameweekNumber: Number(week.data.number),
    teams: scored.teams,
    skipped: scored.skipped,
    reason: scored.reason,
    board,
  };
}
