import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadScoreAudit } from "@/lib/server/score-audit";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const url = new URL(request.url);
    const leagueId = url.searchParams.get("leagueId") ?? "";
    const gameweekId = url.searchParams.get("gameweekId") ?? "";
    const fantasyTeamId = url.searchParams.get("fantasyTeamId") ?? "";
    if (!leagueId || !gameweekId || !fantasyTeamId) {
      return NextResponse.json({ error: "Servono lega, giornata e squadra." }, { status: 400 });
    }
    const audit = await loadScoreAudit(user.id, leagueId, gameweekId, fantasyTeamId);
    return NextResponse.json(audit);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
