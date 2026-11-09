import { NextResponse } from "next/server";
import { loadImportOptions } from "@/lib/server/import-quotations";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { assertServiceEnv } from "@/lib/server/catalog";

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const options = await loadImportOptions(user.id);
    return NextResponse.json(options);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
