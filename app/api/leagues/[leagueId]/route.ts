import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import type { LeagueRules } from "@/lib/league-rules";
import { getLeagueDetail, updateLeague } from "@/lib/server/leagues";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const league = await getLeagueDetail(user.id, leagueId);
    return NextResponse.json({ league });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      regenerateCode?: boolean;
      startMatchday?: number;
      endMatchday?: number;
      rules?: Partial<LeagueRules>;
      grantDelegateUserId?: string;
      revokeDelegateUserId?: string;
    };
    const league = await updateLeague(user.id, leagueId, body);
    return NextResponse.json({ league });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
