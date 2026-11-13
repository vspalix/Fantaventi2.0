import { NextResponse } from "next/server";
import { listPlatformUsers } from "@/lib/server/platform-users";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export async function GET() {
  try {
    await requireSuperAdmin();
    const users = await listPlatformUsers();
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
