import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { setGameweekStart } from "@/lib/server/kickoff-refresh";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { gameweekId?: string; kickoffLocal?: string };
    if (!body.gameweekId || !body.kickoffLocal) {
      return NextResponse.json({ error: "Servono la giornata e l'orario di inizio." }, { status: 400 });
    }
    const result = await setGameweekStart(user.id, { gameweekId: body.gameweekId, kickoffLocal: body.kickoffLocal });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
