import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { setGameweekStatus } from "@/lib/server/test-lab";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { gameweekId?: string; status?: string };
    if (!body.gameweekId || !body.status) {
      return NextResponse.json({ error: "Mancano gameweekId e status." }, { status: 400 });
    }
    const gameweek = await setGameweekStatus(user.id, body.gameweekId, body.status);
    return NextResponse.json({ gameweek });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
