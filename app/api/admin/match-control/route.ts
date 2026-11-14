import { NextResponse } from "next/server";
import { writeAdminAudit } from "@/lib/server/audit";
import { assertServiceEnv } from "@/lib/server/catalog";
import { recalculateExtraordinary, setMatchPostponed } from "@/lib/server/match-control";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const admin = await requireSuperAdmin();
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
      const result = await setMatchPostponed(body.matchId, body.postponed !== false);
      await writeAdminAudit(admin.id, {
        action: "match.postponed",
        targetType: "match",
        targetId: body.matchId,
        detail: { postponed: body.postponed !== false },
      });
      return NextResponse.json(result);
    }
    if (body.action === "recalculate") {
      if (!body.gameweekId) {
        return NextResponse.json({ error: "Serve l'id della giornata." }, { status: 400 });
      }
      const result = await recalculateExtraordinary(body.gameweekId);
      await writeAdminAudit(admin.id, {
        action: "gameweek.recalculate",
        targetType: "gameweek",
        targetId: body.gameweekId,
      });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Azione non riconosciuta." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
