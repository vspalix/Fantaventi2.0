import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadCalendarWeek, loadLeagueHub } from "@/lib/server/league-hub";
import { requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const url = new URL(request.url);
    const gameweekId = url.searchParams.get("gameweek");
    if (url.searchParams.get("view") === "calendar") {
      if (!gameweekId) return NextResponse.json({ error: "Serve la giornata." }, { status: 400 });
      return NextResponse.json({ calendar: await loadCalendarWeek(user.id, leagueId, gameweekId) });
    }
    const hub = await loadLeagueHub(user.id, leagueId, gameweekId);
    return NextResponse.json({ hub });
  } catch (error) {
    return apiError("API /api/leagues/[leagueId]/hub (GET)", error);
  }
}
