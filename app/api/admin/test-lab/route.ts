import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { loadTestLab } from "@/lib/server/test-lab";

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const lab = await loadTestLab(user.id);
    return NextResponse.json({ lab });
  } catch (error) {
    return apiError("API /api/admin/test-lab (GET)", error);
  }
}
