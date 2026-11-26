import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSessionUser } from "@/lib/server/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const admin = createAdminSupabase();
    const rows = await admin
      .from("user_notices")
      .select("id, title, body, created_at, read_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (rows.error) {
      if (/user_notices|schema cache|does not exist/i.test(rows.error.message)) return NextResponse.json({ notices: [] });
      throw new Error(rows.error.message);
    }
    return NextResponse.json({ notices: rows.data ?? [] });
  } catch (error) {
    return apiError("API /api/notices (GET)", error);
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = await request.json() as { id?: string };
    if (!body.id) return NextResponse.json({ ok: true });
    const admin = createAdminSupabase();
    await admin.from("user_notices").update({ read_at: new Date().toISOString() }).eq("id", body.id).eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/notices (POST)", error);
  }
}
