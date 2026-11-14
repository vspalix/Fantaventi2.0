import { NextResponse } from "next/server";
import { writeAdminAudit } from "@/lib/server/audit";
import { assertServiceEnv } from "@/lib/server/catalog";
import { processMatchday } from "@/lib/server/process-matchday";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST() {
  try {
    assertServiceEnv();
    const admin = await requireSuperAdmin();
    const result = await processMatchday();
    await writeAdminAudit(admin.id, {
      action: "votes.recover",
      targetType: "matchday",
      detail: {
        scored: result.votes.scored.length,
        synced: result.votes.synced.length,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
