import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { listPlatformLeagues } from "@/lib/server/platform-control";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const leagues = await listPlatformLeagues();
    return NextResponse.json({ leagues });
  } catch (error) {
    return apiError("API /api/admin/platform-leagues (GET)", error);
  }
}
