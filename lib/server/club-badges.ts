import { cache } from "react";
import { SERIE_A_CLUBS, type ClubBadgeOverride } from "@/lib/club-colors";
import { createAdminSupabase, hasServiceSupabaseEnv } from "@/lib/supabase/admin";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function defaultClubBadges(): ClubBadgeOverride[] {
  return SERIE_A_CLUBS.map((club) => ({
    code: club.code,
    primary: club.colors[0],
    secondary: club.colors[1],
    logoUrl: null,
  }));
}

export const loadClubBadgeOverrides = cache(async (): Promise<ClubBadgeOverride[]> => {
  if (!hasServiceSupabaseEnv()) return [];
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("club_badges")
      .select("club_code, primary_color, secondary_color, logo_url");
    if (error || !data) return [];
    return data.flatMap((row) => {
      const code = String(row.club_code ?? "");
      const primary = String(row.primary_color ?? "");
      const secondary = String(row.secondary_color ?? "");
      if (!SERIE_A_CLUBS.some((club) => club.code === code) || !HEX.test(primary) || !HEX.test(secondary)) return [];
      const logo = typeof row.logo_url === "string" && row.logo_url.trim() ? row.logo_url : null;
      return [{ code, primary, secondary, logoUrl: logo }];
    });
  } catch {
    return [];
  }
});

export function parseClubBadge(input: unknown): ClubBadgeOverride {
  const body = input as { code?: unknown; primary?: unknown; secondary?: unknown; logoUrl?: unknown };
  const code = typeof body.code === "string" ? body.code : "";
  const club = SERIE_A_CLUBS.find((item) => item.code === code);
  if (!club) throw new Error("Club sconosciuto.");
  const primary = typeof body.primary === "string" ? body.primary : "";
  const secondary = typeof body.secondary === "string" ? body.secondary : "";
  if (!HEX.test(primary) || !HEX.test(secondary)) throw new Error("I colori devono essere esadecimali, per esempio #12A0D7.");
  const logoUrl = typeof body.logoUrl === "string" && body.logoUrl.trim() ? body.logoUrl.trim() : null;
  if (logoUrl && logoUrl.length > 120000) throw new Error("Il logo è troppo pesante. Resta sotto i 40 KB oppure incolla un indirizzo.");
  if (logoUrl && !logoUrl.startsWith("https://") && !logoUrl.startsWith("data:image/")) {
    throw new Error("Il logo deve essere un indirizzo https o un'immagine caricata.");
  }
  return { code, primary, secondary, logoUrl };
}
