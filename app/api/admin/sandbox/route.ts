import { NextResponse } from "next/server";
import { writeAdminAudit } from "@/lib/server/audit";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { resetSandbox, seedSandbox, simulateSandbox } from "@/lib/server/sandbox-lab";
import { errorMessage, errorStatus } from "@/lib/server/session";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const admin = await requireSuperAdmin();
    const body = (await request.json()) as { action?: string; cursor?: number; size?: number };
    if (body.action === "seed") {
      const result = await seedSandbox(admin.id);
      await writeAdminAudit(admin.id, { action: "sandbox.seed", targetType: "league", targetId: result.leagueId, detail: { teams: result.teams } });
      return NextResponse.json(result);
    }
    if (body.action === "simulate") {
      const result = await simulateSandbox(body.cursor ?? 1, body.size ?? 1);
      if (result.nextCursor == null) {
        await writeAdminAudit(admin.id, {
          action: "sandbox.simulate",
          targetType: "league",
          detail: { weeks: result.weeks, anomalies: result.anomalies.length },
        });
      }
      return NextResponse.json(result);
    }
    if (body.action === "reset") {
      const result = await resetSandbox();
      await writeAdminAudit(admin.id, { action: "sandbox.reset", targetType: "league", detail: result });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Azione sandbox sconosciuta." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
