import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadLeagueHub } from "@/lib/server/league-hub";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const gameweekId = new URL(request.url).searchParams.get("gameweek");
    const hub = await loadLeagueHub(user.id, leagueId, gameweekId);
    return NextResponse.json({ hub });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
