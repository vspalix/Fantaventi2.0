import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

const missingTable = /device_push_tokens|schema cache|could not find|relation/i;

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as { token?: string; platform?: string };
    const token = body.token?.trim() ?? "";
    const platform = body.platform;
    if (token.length < 20 || token.length > 4096 || (platform !== "ios" && platform !== "android")) {
      return NextResponse.json({ error: "Token push nativo incompleto." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const existing = await admin.from("device_push_tokens").select("user_id").eq("token", token).maybeSingle();
    if (existing.error) {
      if (missingTable.test(existing.error.message)) {
        return NextResponse.json({ error: "Per le push native esegui supabase/device_push_tokens.sql nell'editor SQL di Supabase." }, { status: 409 });
      }
      throw new Error(existing.error.message);
    }
    if (existing.data && existing.data.user_id !== user.id) {
      return NextResponse.json({ error: "Questo dispositivo è già collegato a un altro account." }, { status: 409 });
    }

    const saved = await admin.from("device_push_tokens").upsert({
      token,
      user_id: user.id,
      platform,
      updated_at: new Date().toISOString(),
    }, { onConflict: "token" });
    if (saved.error) {
      if (missingTable.test(saved.error.message)) {
        return NextResponse.json({ error: "Per le push native esegui supabase/device_push_tokens.sql nell'editor SQL di Supabase." }, { status: 409 });
      }
      throw new Error(saved.error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
