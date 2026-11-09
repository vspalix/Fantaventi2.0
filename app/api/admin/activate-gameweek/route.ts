import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { activateGameweek } from "@/lib/server/test-lab";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { gameweekId?: string };
    if (!body.gameweekId) {
      return NextResponse.json({ error: "Manca la giornata." }, { status: 400 });
    }
    const gameweek = await activateGameweek(user.id, body.gameweekId);
    return NextResponse.json({ gameweek });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
