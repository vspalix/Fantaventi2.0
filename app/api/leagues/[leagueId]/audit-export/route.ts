import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadScoreAudit } from "@/lib/server/score-audit";
import { getLeagueDetail } from "@/lib/server/leagues";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const league = await getLeagueDetail(user.id, leagueId);
    if (!league.isManager && !league.platformOverride) {
      return NextResponse.json({ error: "La scatola nera è riservata all'admin della lega." }, { status: 403 });
    }
    const gameweekId = new URL(request.url).searchParams.get("gameweekId") ?? "";
    if (!gameweekId) return NextResponse.json({ error: "Manca la giornata." }, { status: 400 });
    const audits = [];
    for (const team of league.participants) {
      audits.push(await loadScoreAudit(user.id, leagueId, gameweekId, team.fantasyTeamId, "member"));
    }
    return NextResponse.json({
      leagueId,
      leagueName: league.name,
      gameweekId,
      exportedAt: new Date().toISOString(),
      teams: audits,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
