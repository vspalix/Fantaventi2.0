import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { loadSystemHealth } from "@/lib/server/system-health";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json(await loadSystemHealth());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
