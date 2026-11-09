import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadLiveCenter } from "@/lib/server/live-center";
import { getLeagueDetail } from "@/lib/server/leagues";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const league = await getLeagueDetail(user.id, leagueId);
    const live = await loadLiveCenter(league, user.id);
    return NextResponse.json({ live });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
