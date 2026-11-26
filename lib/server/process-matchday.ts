import { runEngagementTick } from "@/lib/server/engagement-tick";
import { processGameweekLifecycle } from "@/lib/server/gameweek-lifecycle";
import { syncDueMatchVotes } from "@/lib/server/sync-match-votes";
import { meter } from "@/lib/server/telemetry";

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
    skipped: officialWrites === 0,
    votes,
    lifecycle,
    engagement,
  };
}
