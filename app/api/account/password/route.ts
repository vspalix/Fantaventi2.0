import { NextResponse } from "next/server";
import { clearPasswordReset } from "@/lib/server/account-password";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

export async function POST() {
  try {
    const user = await requireSessionUser();
    await clearPasswordReset(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
