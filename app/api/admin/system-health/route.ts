import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { loadSystemHealth } from "@/lib/server/system-health";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json(await loadSystemHealth());
  } catch (error) {
    return apiError("API /api/admin/system-health (GET)", error);
  }
}
