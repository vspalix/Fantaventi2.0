import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { defaultClubBadges, loadClubBadgeOverrides, parseClubBadge } from "@/lib/server/club-badges";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { forgetShared, SHARED_TAGS } from "@/lib/server/shared-cache";
import { assertServiceEnv } from "@/lib/server/catalog";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const saved = await loadClubBadgeOverrides();
    const overrides = new Map(saved.map((badge) => [badge.code, badge]));
    return NextResponse.json({
      clubs: defaultClubBadges().map((badge) => overrides.get(badge.code) ?? badge),
      persisted: saved.length > 0,
    });
  } catch (error) {
    return apiError("API /api/admin/club-badges (GET)", error);
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const badge = parseClubBadge(await request.json());
    const admin = createAdminSupabase();
    const { error } = await admin.from("club_badges").upsert({
      club_code: badge.code,
      primary_color: badge.primary,
      secondary_color: badge.secondary,
      logo_url: badge.logoUrl,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      const missing = /club_badges|schema cache/i.test(error.message);
      return NextResponse.json(
        { error: missing ? "Manca la tabella. Esegui club_badges.sql nell'editor SQL, poi riprova." : error.message },
        { status: missing ? 503 : 500 },
      );
    }
    forgetShared(SHARED_TAGS.clubBadges);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/admin/club-badges (POST)", error);
  }
}
