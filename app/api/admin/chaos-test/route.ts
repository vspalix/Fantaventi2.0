import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { runChaosTest } from "@/lib/server/chaos-lab";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export const maxDuration = 60;

export async function POST() {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const report = await runChaosTest(user.id);
    return NextResponse.json(report, { status: report.passed ? 200 : 409 });
  } catch (error) {
    return apiError("API /api/admin/chaos-test (POST)", error);
  }
}
