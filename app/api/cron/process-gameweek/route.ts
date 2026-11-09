import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { processGameweekLifecycle } from "@/lib/server/gameweek-lifecycle";
import { refreshSerieAKickoffs } from "@/lib/server/kickoff-refresh";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { syncDueMatchVotes } from "@/lib/server/sync-match-votes";
import { meter } from "@/lib/server/telemetry";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const alternate = request.headers.get("x-cron-secret") ?? "";
  return bearer === secret || alternate === secret;
}

async function run(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: "Cron non autorizzato." }, { status: 401 });
    }
    assertServiceEnv();
    const votes = await meter("vote-fetch", () => syncDueMatchVotes());
    const result = await meter("gameweek-calc", () => processGameweekLifecycle());
    let kickoffs: { skipped: boolean; reason: string | null; updated: number } = {
      skipped: true,
      reason: null,
      updated: 0,
    };
    try {
      const refresh = await refreshSerieAKickoffs();
      kickoffs = { skipped: refresh.skipped, reason: refresh.reason, updated: refresh.updated };
    } catch (error) {
      kickoffs = { skipped: true, reason: errorMessage(error), updated: 0 };
    }
    return NextResponse.json({ ...result, kickoffs, votes });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
