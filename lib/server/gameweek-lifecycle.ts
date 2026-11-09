import { schemaHint, scoreOfficialGameweek } from "@/lib/server/live-score";
import { MATCH_CLOSE_MS } from "@/lib/server/match-window";
import { createAdminSupabase } from "@/lib/supabase/admin";

const APPEAL_MS = 24 * 60 * 60 * 1000;
const MATCH_WINDOW_MS = MATCH_CLOSE_MS;

type GameweekRow = {
  id: string;
  number: number;
  status: string;
  deadline_at: string;
  scored_at: string | null;
};

export async function processGameweekLifecycle(now = new Date(), options?: { finalize?: boolean; scoreReadyWeeks?: boolean }) {
  const admin = createAdminSupabase();
  const stamp = now.toISOString();
  const { data, error } = await admin
    .from("gameweeks")
    .select("id, number, status, deadline_at, scored_at")
    .order("number");
  if (error) throw new Error(schemaHint(error.message));

  const gameweeks = (data ?? []) as GameweekRow[];
  const locked: number[] = [];
  const scored: number[] = [];
  const finalized: number[] = [];
  const skipped: { number: number; reason: string }[] = [];
  const matches = await advanceMatchStates(admin, gameweeks.map((gameweek) => gameweek.id), now);

  for (const gameweek of gameweeks) {
    const kickoff = await firstKickoff(admin, gameweek.id);
    const started = kickoff !== null && kickoff <= now.getTime();
    const deadlinePassed = new Date(gameweek.deadline_at).getTime() <= now.getTime();
    const heldOpen = gameweek.status === "open" && !deadlinePassed;
    if (!heldOpen && (gameweek.status === "scheduled" || gameweek.status === "open") && (started || deadlinePassed)) {
      if (started) await lockMatches(admin, gameweek.id, now);
      const { error: statusError } = await admin.from("gameweeks").update({ status: "locked" }).eq("id", gameweek.id);
      if (statusError) throw new Error(schemaHint(statusError.message));
      const { error: lineupError } = await admin
        .from("lineups")
        .update({ status: "locked", locked_at: stamp })
        .eq("gameweek_id", gameweek.id)
        .eq("status", "draft");
      if (lineupError) throw new Error(lineupError.message);
      gameweek.status = "locked";
      locked.push(gameweek.number);
    }
  }

  if (options?.scoreReadyWeeks !== false) for (const gameweek of gameweeks) {
    if (gameweek.status !== "locked") continue;
    const matches = await admin.from("real_matches").select("status").eq("gameweek_id", gameweek.id);
    if (matches.error) {
      if (/real_matches|schema cache|could not find/i.test(matches.error.message)) {
        skipped.push({ number: gameweek.number, reason: "Tabella real_matches assente. Esegui production_architecture.sql." });
        continue;
      }
      throw new Error(matches.error.message);
    }
    const rows = matches.data ?? [];
    if (rows.length === 0) {
      skipped.push({ number: gameweek.number, reason: "Nessuna partita reale." });
      continue;
    }
    if (rows.some((match) => match.status !== "finished")) {
      skipped.push({ number: gameweek.number, reason: "Ci sono partite non finite." });
      continue;
    }
    const imports = await admin
      .from("vote_imports")
      .select("id", { count: "exact", head: true })
      .eq("gameweek_id", gameweek.id);
    if (imports.error) throw new Error(imports.error.message);
    if ((imports.count ?? 0) === 0) {
      skipped.push({ number: gameweek.number, reason: "Import voti non ancora presente." });
      continue;
    }

    const outcome = await scoreOfficialGameweek(gameweek.id);
    if (outcome.skipped) {
      skipped.push({ number: gameweek.number, reason: outcome.reason ?? "Calcolo non rieseguito." });
      continue;
    }
    const { error: scoreError } = await admin
      .from("gameweeks")
      .update({ status: "scored", scored_at: stamp })
      .eq("id", gameweek.id);
    if (scoreError) throw new Error(schemaHint(scoreError.message));
    gameweek.status = "scored";
    gameweek.scored_at = stamp;
    scored.push(gameweek.number);
  }

  if (options?.finalize !== false) {
    for (const gameweek of gameweeks) {
      if (gameweek.status !== "scored" || !gameweek.scored_at) continue;
      if (now.getTime() - new Date(gameweek.scored_at).getTime() < APPEAL_MS) continue;
      const { error: finalError } = await admin.from("gameweeks").update({ status: "final" }).eq("id", gameweek.id);
      if (finalError) throw new Error(schemaHint(finalError.message));
      finalized.push(gameweek.number);
    }
  }

  return { locked, scored, finalized, skipped, matches };
}

async function advanceMatchStates(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekIds: string[],
  now: Date,
) {
  if (gameweekIds.length === 0) return { finished: 0, live: 0, locked: 0 };
  const nowIso = now.toISOString();
  const windowEnd = new Date(now.getTime() - MATCH_WINDOW_MS).toISOString();
  const live = await transitionMatches(admin, gameweekIds, "locked", "live", nowIso, windowEnd);
  const locked = await transitionMatches(admin, gameweekIds, "scheduled", "locked", nowIso, windowEnd);
  return {
    finished: 0,
    live,
    locked,
  };
}

async function transitionMatches(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekIds: string[],
  from: string,
  to: string,
  kickoffUntil: string,
  kickoffAfter: string | null,
) {
  let query = admin
    .from("real_matches")
    .update({ status: to })
    .in("gameweek_id", gameweekIds)
    .eq("status", from)
    .lte("kickoff_at", kickoffUntil);
  if (kickoffAfter) query = query.gt("kickoff_at", kickoffAfter);
  const { data, error } = await query.select("id");
  if (error) {
    if (/invalid input value|enum|real_matches|schema cache|could not find/i.test(error.message)) return 0;
    throw new Error(error.message);
  }
  return data?.length ?? 0;
}

async function firstKickoff(admin: ReturnType<typeof createAdminSupabase>, gameweekId: string) {
  const matches = await admin.from("real_matches").select("kickoff_at").eq("gameweek_id", gameweekId);
  if (matches.error) {
    if (/real_matches|schema cache|could not find/i.test(matches.error.message)) return null;
    throw new Error(matches.error.message);
  }
  const times = (matches.data ?? [])
    .map((row) => new Date(row.kickoff_at as string).getTime())
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return null;
  return Math.min(...times);
}

async function lockMatches(admin: ReturnType<typeof createAdminSupabase>, gameweekId: string, now: Date) {
  const { error } = await admin
    .from("real_matches")
    .update({ status: "locked" })
    .eq("gameweek_id", gameweekId)
    .eq("status", "scheduled")
    .lte("kickoff_at", now.toISOString());
  if (error && !/locked|invalid input value|enum/i.test(error.message)) throw new Error(error.message);
}
