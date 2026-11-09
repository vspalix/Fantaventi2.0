import { fetchFantacalcioMatchweek, type FantacalcioPlayerVote } from "@/lib/server/fantacalcio-live";
import type { PlayerStat } from "@/lib/engine/calculator";
import type { PlayerRole } from "@/lib/types";
import { createAdminSupabase } from "@/lib/supabase/admin";

const FRESH_MS = 60_000;

const cache = new Map<string, { at: number; votes: FantacalcioPlayerVote[] }>();

async function publishedVotes(seasonCode: string, gameweekNumber: number) {
  const key = `${seasonCode}:${gameweekNumber}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.votes;
  const page = await fetchFantacalcioMatchweek(seasonCode, gameweekNumber);
  cache.set(key, { at: Date.now(), votes: page.votes });
  return page.votes;
}

export async function overlayPublishedVotes(
  stats: Map<string, PlayerStat>,
  seasonCode: string,
  gameweekNumber: number,
  roles: ReadonlyMap<string, PlayerRole>,
) {
  const next = new Map(stats);
  if (!seasonCode) return next;
  let votes: FantacalcioPlayerVote[];
  try {
    votes = await publishedVotes(seasonCode, gameweekNumber);
  } catch {
    return next;
  }
  if (votes.length === 0) return next;
  const admin = createAdminSupabase();
  const players = await admin.from("players").select("id, external_ref").in("external_ref", votes.map((vote) => vote.externalRef));
  if (players.error) return next;
  const playerId = new Map((players.data ?? []).map((player) => [player.external_ref as string, player.id as string]));
  for (const vote of votes) {
    const id = playerId.get(vote.externalRef);
    if (!id) continue;
    const current = next.get(id);
    next.set(id, {
      playerId: id,
      role: current?.role ?? roles.get(id) ?? "MID",
      voto: vote.voto,
      goals: vote.goals,
      assists: vote.assists,
      yellowCards: vote.yellowCards,
      redCards: vote.redCards,
      penaltiesScored: vote.penaltiesScored,
      penaltiesMissed: vote.penaltiesMissed,
      penaltiesSaved: vote.penaltiesSaved,
      ownGoals: vote.ownGoals,
      goalsConceded: vote.goalsConceded,
      postponed: false,
      withoutVote: vote.voto === null,
    });
  }
  return next;
}
