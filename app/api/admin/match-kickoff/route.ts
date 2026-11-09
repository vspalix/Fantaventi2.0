import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { setMatchKickoff } from "@/lib/server/kickoff-refresh";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { matchId?: string; kickoffLocal?: string };
    if (!body.matchId || !body.kickoffLocal) {
      return NextResponse.json({ error: "Servono la partita e l'orario." }, { status: 400 });
    }
    const result = await setMatchKickoff(user.id, { matchId: body.matchId, kickoffLocal: body.kickoffLocal });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
