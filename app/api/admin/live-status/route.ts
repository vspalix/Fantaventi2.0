import { NextResponse } from "next/server";
import { writeAdminAudit } from "@/lib/server/audit";
import { assertServiceEnv } from "@/lib/server/catalog";
import { forceLiveRound, readLiveDiagnostics } from "@/lib/server/live-diagnostics";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const leagueId = new URL(request.url).searchParams.get("leagueId");
    return NextResponse.json(await readLiveDiagnostics(leagueId));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST() {
  try {
    assertServiceEnv();
    const admin = await requireSuperAdmin();
    const result = await forceLiveRound();
    await writeAdminAudit(admin.id, {
      action: "live.force",
      targetType: "gameweek",
      detail: {
        gameweekNumber: result.gameweekNumber,
        synced: result.votes.synced.length,
        errors: result.votes.errors.length,
        scored: result.score?.teams ?? 0,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
