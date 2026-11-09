import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { calculateImportedGameweek } from "@/lib/server/match-control";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { meter } from "@/lib/server/telemetry";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { leagueId?: string; gameweekId?: string };
    const leagueId = body.leagueId;
    const gameweekId = body.gameweekId;
    if (!leagueId || !gameweekId) {
      return NextResponse.json({ error: "Servono lega e giornata." }, { status: 400 });
    }
    const result = await meter("gameweek-calc", () => calculateImportedGameweek(user.id, { leagueId, gameweekId }));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
