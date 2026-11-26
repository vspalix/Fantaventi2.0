import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { writeAdminAudit } from "@/lib/server/audit";
import { assertServiceEnv } from "@/lib/server/catalog";
import { recalculateExtraordinary, recalculatePartial, setMatchHold, setMatchPostponed } from "@/lib/server/match-control";
import type { MatchHold } from "@/lib/server/held-lineup";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const admin = await requireSuperAdmin();
    const body = (await request.json()) as {
      action?: string;
      matchId?: string;
      postponed?: boolean;
      hold?: MatchHold;
      gameweekId?: string;
      clubIds?: string[];
    };
    if (body.action === "hold") {
      if (!body.matchId || (body.hold !== "none" && body.hold !== "postponed" && body.hold !== "suspended")) {
        return NextResponse.json({ error: "Servono la partita e lo stato." }, { status: 400 });
      }
      const result = await setMatchHold(body.matchId, body.hold);
      await writeAdminAudit(admin.id, {
        action: "match.hold",
        targetType: "match",
        targetId: body.matchId,
        detail: { hold: body.hold },
      });
      return NextResponse.json(result);
    }
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
    if (body.action === "recalculate-partial") {
      if (!body.gameweekId) {
        return NextResponse.json({ error: "Serve l'id della giornata." }, { status: 400 });
      }
      const result = await recalculatePartial(body.gameweekId, body.clubIds ?? []);
      await writeAdminAudit(admin.id, {
        action: "gameweek.recalculate_partial",
        targetType: "gameweek",
        targetId: body.gameweekId,
        detail: { clubs: body.clubIds ?? [], teams: result.teams },
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
    return apiError("API /api/admin/match-control (POST)", error);
  }
}
