import { cache } from "react";
import type { Announcement, AnnouncementKind } from "@/lib/announcements";
import { forgetShared, shared, SHARED_TAGS } from "@/lib/server/shared-cache";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type { Announcement, AnnouncementKind };

const HTTPS = /^https:\/\/[^\s]+$/i;

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function missing(message: string) {
  return /app_announcements|user_notices|schema cache|could not find|does not exist/i.test(message);
}

function mapRow(row: {
  id: string;
  kind: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_href: string | null;
  is_active: boolean;
  once_per_user: boolean;
}): Announcement {
  const kind: AnnouncementKind = row.kind === "image" || row.kind === "both" ? row.kind : "text";
  return {
    id: row.id,
    kind,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    isActive: row.is_active,
    oncePerUser: row.once_per_user,
  };
}

async function queryActiveAnnouncements(): Promise<Announcement[]> {
  const admin = createAdminSupabase();
  const rows = await admin
    .from("app_announcements")
    .select("id, kind, title, body, image_url, cta_label, cta_href, is_active, once_per_user")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(3);
  if (rows.error) throw new Error(rows.error.message);
  return (rows.data ?? []).map((row) => mapRow(row as Parameters<typeof mapRow>[0]));
}

// Gli annunci attivi sono uguali per tutti: chi li ha già visti lo ricorda il telefono o il browser.
const sharedActiveAnnouncements = shared(SHARED_TAGS.announcements, 300, queryActiveAnnouncements);

export const loadActiveAnnouncements = cache(async (): Promise<Announcement[]> => {
  try {
    return await sharedActiveAnnouncements();
  } catch {
    return [];
  }
});

export async function listAnnouncements(): Promise<Announcement[]> {
  const admin = createAdminSupabase();
  const rows = await admin
    .from("app_announcements")
    .select("id, kind, title, body, image_url, cta_label, cta_href, is_active, once_per_user")
    .order("updated_at", { ascending: false });
  if (rows.error) {
    if (missing(rows.error.message)) throw httpError("Manca la tabella. Esegui app_announcements.sql nell'editor SQL.", 503);
    throw new Error(rows.error.message);
  }
  return (rows.data ?? []).map((row) => mapRow(row as Parameters<typeof mapRow>[0]));
}

export function parseAnnouncement(input: unknown) {
  const body = input as {
    id?: unknown;
    kind?: unknown;
    title?: unknown;
    text?: unknown;
    imageUrl?: unknown;
    ctaLabel?: unknown;
    ctaHref?: unknown;
    isActive?: unknown;
    oncePerUser?: unknown;
  };
  const kind: AnnouncementKind = body.kind === "image" || body.kind === "both" ? body.kind : "text";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 600) : "";
  const image = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  if (image && !image.startsWith("https://") && !image.startsWith("data:image/")) {
    throw httpError("L'immagine deve essere un indirizzo https o un file caricato.", 400);
  }
  if (image.length > 180000) throw httpError("L'immagine è troppo pesante. Resta sotto i 120 KB.", 400);
  const href = typeof body.ctaHref === "string" ? body.ctaHref.trim() : "";
  if (href && !HTTPS.test(href)) throw httpError("Il link del pulsante deve iniziare con https://.", 400);
  if (kind !== "image" && !title && !text) throw httpError("Scrivi almeno un titolo o un testo.", 400);
  if (kind !== "text" && !image) throw httpError("La locandina ha bisogno di un'immagine.", 400);
  return {
    id: typeof body.id === "string" ? body.id : null,
    kind,
    title: title || null,
    body: text || null,
    image_url: image || null,
    cta_label: typeof body.ctaLabel === "string" ? body.ctaLabel.trim().slice(0, 40) || null : null,
    cta_href: href || null,
    is_active: body.isActive !== false,
    once_per_user: body.oncePerUser !== false,
    updated_at: new Date().toISOString(),
  };
}

export async function saveAnnouncement(input: unknown) {
  const row = parseAnnouncement(input);
  const admin = createAdminSupabase();
  const payload = {
    kind: row.kind,
    title: row.title,
    body: row.body,
    image_url: row.image_url,
    cta_label: row.cta_label,
    cta_href: row.cta_href,
    is_active: row.is_active,
    once_per_user: row.once_per_user,
    updated_at: row.updated_at,
  };
  const saved = row.id
    ? await admin.from("app_announcements").update(payload).eq("id", row.id)
    : await admin.from("app_announcements").insert(payload);
  if (saved.error) {
    if (missing(saved.error.message)) throw httpError("Manca la tabella. Esegui app_announcements.sql nell'editor SQL.", 503);
    throw new Error(saved.error.message);
  }
  forgetShared(SHARED_TAGS.announcements);
}

export async function setAnnouncementActive(id: string, isActive: boolean) {
  const admin = createAdminSupabase();
  const saved = await admin.from("app_announcements").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", id);
  if (saved.error) throw new Error(saved.error.message);
  forgetShared(SHARED_TAGS.announcements);
}
