import { randomUUID } from "node:crypto";
import { moderateImage, moderateText } from "@/lib/moderation";
import { reportError, reportUnlessMissing } from "@/lib/server/error-report";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type SponsorItem = {
  id: string;
  label: string;
  imageUrl: string;
  href: string;
};

export type SponsorStrip = {
  scrollSeconds: number;
  items: SponsorItem[];
};

const KEY = "home_sponsors";
const EMPTY: SponsorStrip = { scrollSeconds: 16, items: [] };

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function secondsOf(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 16;
  return Math.max(4, Math.min(90, Math.round(parsed)));
}

function asStrip(value: unknown): SponsorStrip {
  const row = (value ?? {}) as { scrollSeconds?: unknown; items?: unknown };
  const items = Array.isArray(row.items) ? row.items.flatMap((item) => {
    const sponsor = item as { id?: unknown; label?: unknown; imageUrl?: unknown; href?: unknown };
    const label = typeof sponsor.label === "string" ? sponsor.label.trim() : "";
    if (!label) return [];
    return [{
      id: typeof sponsor.id === "string" && sponsor.id ? sponsor.id : randomUUID(),
      label: label.slice(0, 48),
      imageUrl: typeof sponsor.imageUrl === "string" ? sponsor.imageUrl : "",
      href: typeof sponsor.href === "string" && sponsor.href.startsWith("https://") ? sponsor.href : "",
    }];
  }) : [];
  return { scrollSeconds: secondsOf(row.scrollSeconds), items };
}

export async function readSponsors(): Promise<SponsorStrip> {
  try {
    const admin = createAdminSupabase();
    const row = await admin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    if (row.error) reportUnlessMissing("Home: sponsor", new Error(row.error.message));
    if (row.error || !row.data) return EMPTY;
    return asStrip(row.data.value);
  } catch (error) {
    void reportError("Home: sponsor", error);
    return EMPTY;
  }
}

async function writeSponsors(strip: SponsorStrip) {
  const admin = createAdminSupabase();
  const saved = await admin.from("app_settings").upsert({
    key: KEY,
    value: strip,
    updated_at: new Date().toISOString(),
  });
  if (saved.error) {
    if (/app_settings|schema cache|could not find|does not exist/i.test(saved.error.message)) {
      throw httpError("Manca app_settings. La striscia sponsor non è stata salvata.", 503);
    }
    throw new Error(saved.error.message);
  }
  return strip;
}

export async function saveSponsorStrip(input: { scrollSeconds: number; items: SponsorItem[] }) {
  for (const item of input.items) {
    const text = moderateText(item.label);
    if (text) throw httpError(`Sponsor «${item.label.slice(0, 24)}»: ${text}`, 400);
  }
  return writeSponsors({
    scrollSeconds: secondsOf(input.scrollSeconds),
    items: input.items.map((item) => ({
      id: item.id || randomUUID(),
      label: item.label.trim().slice(0, 48),
      imageUrl: item.imageUrl,
      href: item.href.startsWith("https://") ? item.href : "",
    })).filter((item) => item.label),
  });
}

export async function uploadSponsorImage(bytes: Buffer, mime: string) {
  const image = moderateImage(bytes, mime);
  if (image) throw httpError(image, 400);
  const admin = createAdminSupabase();
  const extension = mime === "image/png" ? "png" : "jpg";
  const path = `sponsors/${randomUUID()}.${extension}`;
  const uploaded = await admin.storage.from("brand-assets").upload(path, bytes, { contentType: mime, upsert: false });
  if (uploaded.error) {
    if (/bucket|not found|brand-assets/i.test(uploaded.error.message)) {
      throw httpError("Manca il bucket dei file. Esegui supabase/brand_storage.sql nell'editor SQL.", 503);
    }
    throw new Error(uploaded.error.message);
  }
  return admin.storage.from("brand-assets").getPublicUrl(path).data.publicUrl;
}
