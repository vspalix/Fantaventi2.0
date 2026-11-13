import { NextResponse } from "next/server";
import { deletePlatformUser, requirePasswordReset } from "@/lib/server/platform-users";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    await requireSuperAdmin();
    const { userId } = await context.params;
    await requirePasswordReset(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
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
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
