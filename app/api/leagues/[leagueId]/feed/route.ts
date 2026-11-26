import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { listLeagueFeed } from "@/lib/server/league-feed";
import { getLeagueDetail } from "@/lib/server/leagues";
import { requireSessionUser } from "@/lib/server/session";

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
    return apiError("API /api/leagues/[leagueId]/feed (GET)", error);
  }
}
