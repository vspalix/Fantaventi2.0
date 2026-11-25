import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hostViewAllowed } from "@/lib/server/access-policy";
import { isSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";
import { VIEW_COOKIE } from "@/lib/server/view-mode";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    if (!hasServiceSupabaseEnv()) {
      return NextResponse.json({ error: "Configura Supabase prima di cambiare vista." }, { status: 409 });
    }
    const body = (await request.json()) as { mode?: string };
    const mode = body.mode === "host" ? "host" : "player";
    const platformAdmin = await isSuperAdmin(user.id);
    if (!hostViewAllowed(platformAdmin, mode)) {
      return NextResponse.json({ error: "La vista admin globale è riservata al super admin." }, { status: 403 });
    }
    const jar = await cookies();
    jar.set(VIEW_COOKIE, mode, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 400,
    });
    return NextResponse.json({ mode, lab: platformAdmin && mode === "host" });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
