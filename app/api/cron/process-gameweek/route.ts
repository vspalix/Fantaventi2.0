import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { processGameweekLifecycle } from "@/lib/server/gameweek-lifecycle";
import { refreshSerieAKickoffs } from "@/lib/server/kickoff-refresh";
import { errorMessage } from "@/lib/server/session";
import { prepareVoteClock, runPlannedReads } from "@/lib/server/sync-match-votes";
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
    // La fonte dei voti si contatta solo nei momenti previsti.
    const { snapshot, plan } = await prepareVoteClock();
    const votes = await meter("vote-fetch", () => runPlannedReads(snapshot, plan));
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
    return apiError("API /api/cron/process-gameweek", error);
  }
}

export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
