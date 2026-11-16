import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadHomePromo, parseHomePromo } from "@/lib/server/home-promo";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json(await loadHomePromo());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const row = parseHomePromo(await request.json());
    const admin = createAdminSupabase();
    const { error } = await admin.from("platform_home").upsert({ id: 1, ...row, updated_at: new Date().toISOString() });
    if (error) {
      const missing = /platform_home|schema cache/i.test(error.message);
      return NextResponse.json(
        { error: missing ? "Manca la tabella. Esegui platform_promo.sql nell'editor SQL, poi riprova." : error.message },
        { status: missing ? 503 : 500 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
