import { DEFAULT_PROBABILI } from "@/lib/home-links";
import { reportError, reportUnlessMissing } from "@/lib/server/error-report";
import { createAdminSupabase } from "@/lib/supabase/admin";

export { DEFAULT_PROBABILI };

export type HomePromo = {
  imageUrl: string;
  href: string | null;
  label: string | null;
};

export type HomeSettings = {
  banner: HomePromo | null;
  probabiliHref: string;
};

const HTTPS = /^https:\/\/[^\s]+$/i;

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export async function loadHomePromo(): Promise<HomeSettings> {
  const fallback: HomeSettings = { banner: null, probabiliHref: DEFAULT_PROBABILI };
  try {
    const admin = createAdminSupabase();
    const row = await admin.from("platform_home").select("promo_image, promo_href, promo_label, probabili_href").eq("id", 1).maybeSingle();
    if (row.error) reportUnlessMissing("Home: locandina", new Error(row.error.message));
    if (row.error || !row.data) return fallback;
    const image = typeof row.data.promo_image === "string" ? row.data.promo_image.trim() : "";
    const href = typeof row.data.promo_href === "string" && HTTPS.test(row.data.promo_href) ? row.data.promo_href : null;
    const label = typeof row.data.promo_label === "string" && row.data.promo_label.trim() ? row.data.promo_label.trim() : null;
    const probabili = typeof row.data.probabili_href === "string" && HTTPS.test(row.data.probabili_href)
      ? row.data.probabili_href
      : DEFAULT_PROBABILI;
    return {
      banner: image ? { imageUrl: image, href, label } : null,
      probabiliHref: probabili,
    };
  } catch (error) {
    void reportError("Home: locandina", error);
    return fallback;
  }
}

export function parseHomePromo(input: unknown) {
  const body = input as { imageUrl?: unknown; href?: unknown; label?: unknown; probabiliHref?: unknown };
  const image = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  if (image && !image.startsWith("https://") && !image.startsWith("data:image/")) {
    throw httpError("L'immagine deve essere un indirizzo https o un file caricato.", 400);
  }
  if (image.length > 180000) throw httpError("L'immagine è troppo pesante. Resta sotto i 120 KB.", 400);
  const hrefText = typeof body.href === "string" ? body.href.trim() : "";
  if (hrefText && !HTTPS.test(hrefText)) throw httpError("Il link del banner deve iniziare con https://.", 400);
  const probabiliText = typeof body.probabiliHref === "string" ? body.probabiliHref.trim() : "";
  if (probabiliText && !HTTPS.test(probabiliText)) throw httpError("Il link delle probabili deve iniziare con https://.", 400);
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 40) : "";
  return {
    promo_image: image || null,
    promo_href: hrefText || null,
    promo_label: label || null,
    probabili_href: probabiliText || DEFAULT_PROBABILI,
  };
}
