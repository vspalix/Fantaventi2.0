import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { writeAdminAudit } from "@/lib/server/audit";
import { deletePlatformUser, requirePasswordReset, setPlatformRole } from "@/lib/server/platform-users";
import { requireSuperAdmin } from "@/lib/server/platform-role";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    await requireSuperAdmin();
    const { userId } = await context.params;
    await requirePasswordReset(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/admin/users/[userId] (POST)", error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const admin = await requireSuperAdmin();
    const { userId } = await context.params;
    const body = (await request.json()) as { platformRole?: string };
    if (body.platformRole !== "super_admin" && body.platformRole !== "member") {
      return NextResponse.json({ error: "Ruolo non riconosciuto." }, { status: 400 });
    }
    await setPlatformRole(admin.id, userId, body.platformRole);
    await writeAdminAudit(admin.id, {
      action: "user.role",
      targetType: "user",
      targetId: userId,
      detail: { platformRole: body.platformRole },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/admin/users/[userId] (PATCH)", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const admin = await requireSuperAdmin();
    const { userId } = await context.params;
    if (userId === admin.id) {
      return NextResponse.json({ error: "Il tuo account si elimina dalla pagina Account." }, { status: 409 });
    }
    await deletePlatformUser(userId);
    await writeAdminAudit(admin.id, { action: "user.delete", targetType: "user", targetId: userId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/admin/users/[userId] (DELETE)", error);
  }
}
