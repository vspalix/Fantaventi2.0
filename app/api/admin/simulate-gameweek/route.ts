import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { simulateLeagueGameweek } from "@/lib/server/simulate-gameweek";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as {
      leagueId?: string;
      gameweekId?: string;
      gameweekNumber?: number;
      status?: "scored" | "final";
    };
    if (!body.leagueId) {
      return NextResponse.json({ error: "Manca leagueId." }, { status: 400 });
    }
    const result = await simulateLeagueGameweek(user.id, {
      leagueId: body.leagueId,
      gameweekId: body.gameweekId,
      gameweekNumber: body.gameweekNumber,
      status: body.status,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
