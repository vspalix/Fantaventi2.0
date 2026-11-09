import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { listPlatformLeagues } from "@/lib/server/platform-control";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const leagues = await listPlatformLeagues();
    return NextResponse.json({ leagues });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
