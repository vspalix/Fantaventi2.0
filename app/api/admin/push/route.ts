import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { sendPushToEveryone, vapidPublicKey } from "@/lib/server/web-push";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { errorMessage, errorStatus } from "@/lib/server/session";

const KINDS = ["deadline", "bonus", "overtake"] as const;

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const admin = createAdminSupabase();
    const templates = await admin.from("notification_templates").select("kind, title, body, enabled").order("kind");
    if (templates.error && /notification_templates|schema cache|could not find|relation/i.test(templates.error.message)) {
      return NextResponse.json({ ready: false, publicKey: vapidPublicKey(), templates: [], subscribers: 0 });
    }
    if (templates.error) throw new Error(templates.error.message);
    const subscribers = await admin.from("push_subscriptions").select("endpoint", { count: "exact", head: true });
    return NextResponse.json({
      ready: true,
      publicKey: vapidPublicKey(),
      templates: templates.data ?? [],
      subscribers: subscribers.count ?? 0,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = (await request.json()) as {
      title?: string;
      message?: string;
      templates?: { kind: string; title: string; body: string; enabled: boolean }[];
    };
    const admin = createAdminSupabase();
    if (body.templates) {
      const rows = body.templates.filter((item) => KINDS.includes(item.kind as (typeof KINDS)[number]));
      const saved = await admin.from("notification_templates").upsert(rows.map((item) => ({
        kind: item.kind,
        title: item.title.trim(),
        body: item.body.trim(),
        enabled: Boolean(item.enabled),
      })));
      if (saved.error) {
        if (/notification_templates|schema cache|could not find|relation/i.test(saved.error.message)) {
          return NextResponse.json({ error: "Esegui engagement.sql nell'editor SQL di Supabase." }, { status: 409 });
        }
        throw new Error(saved.error.message);
      }
      return NextResponse.json({ ok: true });
    }
    const title = body.title?.trim() ?? "";
    const message = body.message?.trim() ?? "";
    if (title.length < 2 || message.length < 2) {
      return NextResponse.json({ error: "Scrivi titolo e testo." }, { status: 400 });
    }
    if (!vapidPublicKey() || !process.env.VAPID_PRIVATE_KEY?.trim()) {
      return NextResponse.json({ error: "Mancano VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nel server." }, { status: 409 });
    }
    const result = await sendPushToEveryone({ title, body: message, url: "/leghe" });
    return NextResponse.json({ sent: result.sent });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
