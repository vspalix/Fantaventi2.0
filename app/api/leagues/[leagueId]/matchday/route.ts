import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadScoreAudit } from "@/lib/server/score-audit";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const url = new URL(request.url);
    const gameweekId = url.searchParams.get("gameweekId") ?? "";
    const fantasyTeamId = url.searchParams.get("fantasyTeamId") ?? "";
    if (!gameweekId || !fantasyTeamId) {
      return NextResponse.json({ error: "Servono giornata e squadra." }, { status: 400 });
    }
    const detail = await loadScoreAudit(user.id, leagueId, gameweekId, fantasyTeamId, "member");
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
