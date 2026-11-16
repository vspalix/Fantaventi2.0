import { NextResponse } from "next/server";
import { listBroadcastLeagues, parseBroadcast, sendBroadcast } from "@/lib/server/broadcast";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json({
      leagues: await listBroadcastLeagues(),
      emailReady: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const parsed = parseBroadcast(await request.json(), { id: user.id, email: user.email ?? null });
    const result = await sendBroadcast(parsed);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
