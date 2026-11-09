import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { lateJoinTest } from "@/lib/server/test-lab";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { leagueId?: string; gameweekNumber?: number };
    if (!body.leagueId || body.gameweekNumber === undefined) {
      return NextResponse.json({ error: "Mancano leagueId e gameweekNumber." }, { status: 400 });
    }
    const report = await lateJoinTest(user.id, body.leagueId, Number(body.gameweekNumber));
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
