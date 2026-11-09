import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { listLeagueFeed } from "@/lib/server/league-feed";
import { getLeagueDetail } from "@/lib/server/leagues";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    await getLeagueDetail(user.id, leagueId);
    const board = await listLeagueFeed(leagueId);
    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
