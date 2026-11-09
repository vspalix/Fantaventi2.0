import { NextResponse } from "next/server";
import { runChaosTest } from "@/lib/server/chaos-lab";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export const maxDuration = 60;

export async function POST() {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const report = await runChaosTest(user.id);
    return NextResponse.json(report, { status: report.passed ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
