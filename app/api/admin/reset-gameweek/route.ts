import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { resetGameweekCalculation } from "@/lib/server/match-control";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { leagueId?: string; gameweekId?: string };
    if (!body.leagueId || !body.gameweekId) {
      return NextResponse.json({ error: "Servono lega e giornata." }, { status: 400 });
    }
    const result = await resetGameweekCalculation(user.id, { leagueId: body.leagueId, gameweekId: body.gameweekId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
