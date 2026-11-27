// I voti provvisori letti agli orari programmati (fine primo tempo e fine partita).
// Le schermate usano solo questi: nessuna apre la pagina della fonte.
// Stanno in una riga di vote_imports, a parte da player_gameweek_stats: il calcolo
// ufficiale non li vede mai.
import { randomUUID } from "node:crypto";
import type { PlayerStat } from "@/lib/engine/calculator";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

export const PROVISIONAL_SOURCE = "fantacalcio-live-provvisorio";
const ROW_KEY = "provvisorio";

export type ProvisionalVote = Omit<PlayerStat, "role" | "postponed" | "withoutVote">;

const COUNTS = [
  "goals",
  "assists",
  "yellowCards",
  "redCards",
  "penaltiesScored",
  "penaltiesMissed",
  "penaltiesSaved",
  "ownGoals",
  "goalsConceded",
] as const;

export function readSnapshot(text: string | null | undefined): ProvisionalVote[] {
  if (!text) return [];
  try {
    const body = JSON.parse(text) as { votes?: unknown };
    if (!Array.isArray(body.votes)) return [];
    return body.votes.flatMap((item) => {
      const row = item as Partial<ProvisionalVote> | null;
      if (!row || typeof row.playerId !== "string") return [];
      const vote: ProvisionalVote = {
        playerId: row.playerId,
        voto: typeof row.voto === "number" ? row.voto : null,
      };
      for (const key of COUNTS) vote[key] = Number(row[key] ?? 0) || 0;
      return [vote];
    });
  } catch {
    return [];
  }
}

/** La lettura più recente vince. Chi non compare nella nuova pagina tiene il voto di prima. */
export function mergeSnapshot(previous: ProvisionalVote[], next: ProvisionalVote[]) {
  const byId = new Map(previous.map((vote) => [vote.playerId, vote]));
  for (const vote of next) {
    // Un «senza voto» non cancella un voto già letto.
    if (vote.voto === null && byId.get(vote.playerId)?.voto != null) continue;
    byId.set(vote.playerId, vote);
  }
  return [...byId.values()];
}

/**
 * Aggiunge i voti provvisori a quelli ufficiali. L'ufficiale vince sempre:
 * chi ha già una riga ufficiale, o ha la partita finita, resta com'è.
 */
export function withProvisionalVotes(
  official: Map<string, PlayerStat>,
  saved: ProvisionalVote[],
  matchFinished: ReadonlySet<string>,
  roles: ReadonlyMap<string, PlayerRole>,
) {
  const stats = new Map(official);
  for (const vote of saved) {
    if (official.has(vote.playerId) || matchFinished.has(vote.playerId)) continue;
    stats.set(vote.playerId, {
      ...vote,
      role: roles.get(vote.playerId) ?? "MID",
      postponed: false,
      withoutVote: vote.voto === null,
    });
  }
  return stats;
}

async function storedRow(gameweekId: string) {
  const row = await createAdminSupabase()
    .from("vote_imports")
    .select("id, source_note")
    .eq("gameweek_id", gameweekId)
    .eq("source", PROVISIONAL_SOURCE)
    .maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return row.data as { id: string; source_note: string } | null;
}

export async function loadProvisionalVotes(gameweekId: string) {
  return readSnapshot((await storedRow(gameweekId))?.source_note);
}

export async function saveProvisionalVotes(gameweekId: string, votes: ProvisionalVote[]) {
  const admin = createAdminSupabase();
  const write = async () => {
    const current = await storedRow(gameweekId);
    const body = {
      source_note: JSON.stringify({ votes: mergeSnapshot(readSnapshot(current?.source_note), votes) }),
      imported_at: new Date().toISOString(),
    };
    return current
      ? admin.from("vote_imports").update(body).eq("id", current.id)
      : admin.from("vote_imports").insert({
        id: randomUUID(),
        gameweek_id: gameweekId,
        source: PROVISIONAL_SOURCE,
        payload_hash: ROW_KEY,
        ...body,
      });
  };
  let saved = await write();
  // Due letture insieme: la seconda trova la riga appena creata e la aggiorna.
  if (saved.error?.code === "23505") saved = await write();
  if (saved.error) throw new Error(saved.error.message);
}
