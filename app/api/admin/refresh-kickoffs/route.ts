import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { refreshKickoffsForAdmin } from "@/lib/server/kickoff-refresh";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST() {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const result = await refreshKickoffsForAdmin(user.id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
