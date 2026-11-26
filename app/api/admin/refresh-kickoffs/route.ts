import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { refreshKickoffsForAdmin } from "@/lib/server/kickoff-refresh";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST() {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const result = await refreshKickoffsForAdmin(user.id);
    return NextResponse.json(result);
  } catch (error) {
    return apiError("API /api/admin/refresh-kickoffs (POST)", error);
  }
}
