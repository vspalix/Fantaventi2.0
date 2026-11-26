import { NextResponse } from "next/server";
import { moderateText } from "@/lib/moderation";
import { isPublicHandle } from "@/lib/public-name";
import { apiError } from "@/lib/server/api-error";
import { deleteOwnAccount } from "@/lib/server/platform-users";
import { requireSessionUser } from "@/lib/server/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = (await request.json()) as { username?: string };
    const username = (body.username ?? "").trim();
    if (!isPublicHandle(username)) {
      return NextResponse.json({ error: "Lo username deve avere da 3 a 20 lettere, numeri, punti, trattini o underscore." }, { status: 400 });
    }
    const rejected = moderateText(username);
    if (rejected) return NextResponse.json({ error: rejected }, { status: 400 });
    const admin = createAdminSupabase();
    const pattern = username.replace(/[%_\\]/g, "\\$&");
    const taken = await admin.from("profiles").select("id").ilike("display_name", pattern).neq("id", user.id).maybeSingle();
    if (taken.error) throw new Error(taken.error.message);
    if (taken.data) return NextResponse.json({ error: "Questo username è già in uso." }, { status: 409 });
    const saved = await admin.from("profiles").update({ display_name: username }).eq("id", user.id);
    if (saved.error) throw new Error(saved.error.message);
    return NextResponse.json({ ok: true, username });
  } catch (error) {
    return apiError("API /api/account (PATCH)", error);
  }
}

export async function DELETE() {
  try {
    const user = await requireSessionUser();
    await deleteOwnAccount(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/account (DELETE)", error);
  }
}
