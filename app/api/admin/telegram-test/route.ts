import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { sendSyncTestAlert } from "@/lib/server/telegram-alert";

export async function POST() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const result = await sendSyncTestAlert();
    if (!result.sent) return NextResponse.json({ ok: false, error: result.reason }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
