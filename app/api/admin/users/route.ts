import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { listPlatformUsers } from "@/lib/server/platform-users";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET() {
  try {
    await requireSuperAdmin();
    const users = await listPlatformUsers();
    return NextResponse.json({ users });
  } catch (error) {
    return apiError("API /api/admin/users (GET)", error);
  }
}
