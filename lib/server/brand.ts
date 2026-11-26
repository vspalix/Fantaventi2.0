import { cache } from "react";
import { accentOrDefault, DEFAULT_BRAND_ACCENT, type BrandSettings } from "@/lib/brand";
import { reportUnlessMissing } from "@/lib/server/error-report";
import { forgetShared, shared, SHARED_TAGS } from "@/lib/server/shared-cache";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type { BrandSettings };
export { DEFAULT_BRAND_ACCENT, accentOrDefault };

const FALLBACK: BrandSettings = {
  logoUrl: "",
  icon192Url: "",
  icon512Url: "",
  accentColor: DEFAULT_BRAND_ACCENT,
  ready: false,
};

function missing(message: string) {
  return /brand_|system_settings|schema cache|could not find|does not exist|column/i.test(message);
}

function fromRow(row: Record<string, unknown> | null, ready: boolean): BrandSettings {
  if (!row) return { ...FALLBACK, ready };
  return {
    logoUrl: typeof row.brand_logo_url === "string" ? row.brand_logo_url.trim() : "",
    icon192Url: typeof row.brand_icon_192_url === "string" ? row.brand_icon_192_url.trim() : "",
    icon512Url: typeof row.brand_icon_512_url === "string" ? row.brand_icon_512_url.trim() : "",
    accentColor: accentOrDefault(typeof row.brand_accent_color === "string" ? row.brand_accent_color : ""),
    ready,
  };
}

async function queryBrand(): Promise<BrandSettings> {
  const admin = createAdminSupabase();
  const row = await admin.from("system_settings").select("brand_logo_url, brand_icon_192_url, brand_icon_512_url, brand_accent_color").eq("id", 1).maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return fromRow((row.data ?? null) as Record<string, unknown> | null, true);
}

async function brandOrFallback(load: () => Promise<BrandSettings>) {
  try {
    return await load();
  } catch (error) {
    // Colori e logo non devono mai bloccare la pagina: si usano quelli di serie.
    reportUnlessMissing("Colori e logo", error);
    return FALLBACK;
  }
}

const sharedBrand = shared(SHARED_TAGS.brand, 300, queryBrand);

export const readBrand = cache(() => brandOrFallback(sharedBrand));

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

async function writeBrand(patch: Record<string, string>) {
  const admin = createAdminSupabase();
  const saved = await admin.from("system_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
  if (saved.error) {
    if (missing(saved.error.message)) throw httpError("Mancano le colonne brand. Esegui supabase/brand_storage.sql nell'editor SQL.", 503);
    throw new Error(saved.error.message);
  }
  forgetShared(SHARED_TAGS.brand);
  return brandOrFallback(queryBrand);
}

export async function saveBrandSlot(slot: "logo" | "icon192" | "icon512", url: string) {
  const column = slot === "logo" ? "brand_logo_url" : slot === "icon192" ? "brand_icon_192_url" : "brand_icon_512_url";
  return writeBrand({ [column]: url });
}

export async function saveBrandAccent(color: string) {
  return writeBrand({ brand_accent_color: accentOrDefault(color) });
}

export async function resetBrand() {
  return writeBrand({
    brand_logo_url: "",
    brand_icon_192_url: "",
    brand_icon_512_url: "",
    brand_accent_color: DEFAULT_BRAND_ACCENT,
  });
}
