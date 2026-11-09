import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { loadTestLab } from "@/lib/server/test-lab";

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const lab = await loadTestLab(user.id);
    return NextResponse.json({ lab });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
