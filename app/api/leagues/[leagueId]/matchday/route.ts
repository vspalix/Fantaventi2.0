import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadCompactSheets, loadScoreAudit } from "@/lib/server/score-audit";
import { requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const url = new URL(request.url);
    const gameweekId = url.searchParams.get("gameweekId") ?? "";
    const fantasyTeamId = url.searchParams.get("fantasyTeamId") ?? "";
    if (url.searchParams.get("scope") === "sheets") {
      if (!gameweekId) return NextResponse.json({ error: "Serve la giornata." }, { status: 400 });
      return NextResponse.json({ sheets: await loadCompactSheets(user.id, leagueId, gameweekId) });
    }
    if (!gameweekId || !fantasyTeamId) {
      return NextResponse.json({ error: "Servono giornata e squadra." }, { status: 400 });
    }
    const detail = await loadScoreAudit(user.id, leagueId, gameweekId, fantasyTeamId, "member");
    return NextResponse.json(detail);
  } catch (error) {
    return apiError("API /api/leagues/[leagueId]/matchday (GET)", error);
  }
}
