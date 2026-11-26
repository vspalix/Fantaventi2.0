import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { clearPasswordReset } from "@/lib/server/account-password";
import { requireSessionUser } from "@/lib/server/session";

export async function POST() {
  try {
    const user = await requireSessionUser();
    await clearPasswordReset(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/account/password (POST)", error);
  }
}
