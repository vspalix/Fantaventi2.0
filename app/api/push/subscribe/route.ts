import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { vapidPublicKey } from "@/lib/server/web-push";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireSessionUser } from "@/lib/server/session";

export async function GET() {
  const publicKey = vapidPublicKey();
  return NextResponse.json({ publicKey });
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
      return NextResponse.json({ error: "Iscrizione push incompleta." }, { status: 400 });
    }
    const admin = createAdminSupabase();
    const existing = await admin
      .from("push_subscriptions")
      .select("user_id")
      .eq("endpoint", body.endpoint)
      .maybeSingle();
    if (existing.error) {
      if (/push_subscriptions|schema cache|could not find|relation/i.test(existing.error.message)) {
        return NextResponse.json({ error: "Per le notifiche esegui engagement.sql nell'editor SQL di Supabase." }, { status: 409 });
      }
      throw new Error(existing.error.message);
    }
    if (existing.data && existing.data.user_id !== user.id) {
      return NextResponse.json({ error: "Questo dispositivo è già collegato a un altro account." }, { status: 409 });
    }
    const saved = await admin.from("push_subscriptions").upsert({
      endpoint: body.endpoint,
      user_id: user.id,
      p256dh: body.keys.p256dh,
      auth_secret: body.keys.auth,
    }, { onConflict: "endpoint" });
    if (saved.error) {
      if (/push_subscriptions|schema cache|could not find|relation/i.test(saved.error.message)) {
        return NextResponse.json({ error: "Per le notifiche esegui engagement.sql nell'editor SQL di Supabase." }, { status: 409 });
      }
      throw new Error(saved.error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/push/subscribe (POST)", error);
  }
}
