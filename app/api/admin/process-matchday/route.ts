import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { processMatchday } from "@/lib/server/process-matchday";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const result = await processMatchday();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
