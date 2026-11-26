import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { loadImportOptions } from "@/lib/server/import-quotations";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { assertServiceEnv } from "@/lib/server/catalog";

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const options = await loadImportOptions(user.id);
    return NextResponse.json(options);
  } catch (error) {
    return apiError("API /api/admin/import-options (GET)", error);
  }
}
