import { NextResponse } from "next/server";
import { deletePlatformUser } from "@/lib/server/platform-users";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

export async function DELETE() {
  try {
    const user = await requireSessionUser();
    await deletePlatformUser(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
