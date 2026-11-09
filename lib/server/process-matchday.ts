import { runEngagementTick } from "@/lib/server/engagement-tick";
import { processGameweekLifecycle } from "@/lib/server/gameweek-lifecycle";
import { MATCH_CLOSE_MS } from "@/lib/server/match-window";
import { syncDueMatchVotes } from "@/lib/server/sync-match-votes";
import { meter } from "@/lib/server/telemetry";

export const MATCHDAY_VOTE_DELAY_MS = MATCH_CLOSE_MS;

export async function processMatchday(now = new Date()) {
  const votes = await meter("vote-fetch", () => syncDueMatchVotes(now));
  const lifecycle = await meter("gameweek-calc", () => processGameweekLifecycle(now, { scoreReadyWeeks: false }));
  const officialWrites = votes.scored.length + lifecycle.scored.length;
  let engagement = { sent: 0, badges: 0 };
  try {
    engagement = await runEngagementTick(now);
  } catch {
    engagement = { sent: 0, badges: 0 };
  }
  return {
    checkedAt: now.toISOString(),
    voteDelayMinutes: MATCHDAY_VOTE_DELAY_MS / 60_000,
    skipped: officialWrites === 0,
    votes,
    lifecycle,
    engagement,
  };
}
