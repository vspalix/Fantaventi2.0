import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { recalculateExtraordinary, setMatchPostponed } from "@/lib/server/match-control";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = (await request.json()) as {
      action?: string;
      matchId?: string;
      postponed?: boolean;
      gameweekId?: string;
    };
    if (body.action === "postponed") {
      if (!body.matchId) {
        return NextResponse.json({ error: "Serve l'id della partita." }, { status: 400 });
      }
      return NextResponse.json(await setMatchPostponed(body.matchId, body.postponed !== false));
    }
    if (body.action === "recalculate") {
      if (!body.gameweekId) {
        return NextResponse.json({ error: "Serve l'id della giornata." }, { status: 400 });
      }
      return NextResponse.json(await recalculateExtraordinary(body.gameweekId));
    }
    return NextResponse.json({ error: "Azione non riconosciuta." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
