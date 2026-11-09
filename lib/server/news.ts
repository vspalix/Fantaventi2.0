import { createAdminSupabase } from "@/lib/supabase/admin";

export type PlatformNews = {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  pinned: boolean;
  published: boolean;
  createdAt: string;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function cleanLink(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (!/^https:\/\/[^\s]+$/i.test(text)) throw httpError("Il link deve iniziare con https://.", 400);
  return text.slice(0, 300);
}

function mapNews(row: {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  pinned: boolean;
  published: boolean;
  created_at: string;
}): PlatformNews {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    linkUrl: row.link_url,
    linkLabel: row.link_label,
    pinned: row.pinned,
    published: row.published,
    createdAt: row.created_at,
  };
}

export async function listPublishedNews(limit = 4): Promise<PlatformNews[]> {
  const admin = createAdminSupabase();
  const rows = await admin
    .from("platform_news")
    .select("id, title, body, link_url, link_label, pinned, published, created_at")
    .eq("published", true)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (rows.error) {
    if (/platform_news|schema cache|could not find|does not exist/i.test(rows.error.message)) return [];
    throw new Error(rows.error.message);
  }
  return (rows.data ?? []).map((row) => mapNews(row as Parameters<typeof mapNews>[0]));
}

export async function listAllNews(): Promise<PlatformNews[]> {
  const admin = createAdminSupabase();
  const rows = await admin
    .from("platform_news")
    .select("id, title, body, link_url, link_label, pinned, published, created_at")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (rows.error) {
    if (/platform_news|schema cache|could not find|does not exist/i.test(rows.error.message)) {
      throw httpError("Per le news esegui platform_news.sql.", 409);
    }
    throw new Error(rows.error.message);
  }
  return (rows.data ?? []).map((row) => mapNews(row as Parameters<typeof mapNews>[0]));
}

export async function saveNews(input: {
  id?: string;
  title?: string;
  body?: string;
  linkUrl?: string;
  linkLabel?: string;
  pinned?: boolean;
  published?: boolean;
}) {
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (title.length < 2 || title.length > 80) throw httpError("Il titolo sta tra 2 e 80 caratteri.", 400);
  if (body.length < 2 || body.length > 400) throw httpError("Il testo sta tra 2 e 400 caratteri.", 400);
  const linkUrl = cleanLink(input.linkUrl);
  const linkLabel = input.linkLabel?.trim().slice(0, 40) || (linkUrl ? "Apri" : null);
  const row = {
    title,
    body,
    link_url: linkUrl,
    link_label: linkLabel,
    pinned: input.pinned === true,
    published: input.published !== false,
  };
  const admin = createAdminSupabase();
  const saved = input.id
    ? await admin.from("platform_news").update(row).eq("id", input.id).select("id, title, body, link_url, link_label, pinned, published, created_at").single()
    : await admin.from("platform_news").insert(row).select("id, title, body, link_url, link_label, pinned, published, created_at").single();
  if (saved.error) {
    if (/platform_news|schema cache|could not find|does not exist/i.test(saved.error.message)) {
      throw httpError("Per le news esegui platform_news.sql.", 409);
    }
    throw new Error(saved.error.message);
  }
  return mapNews(saved.data);
}

export async function deleteNews(id: string) {
  const admin = createAdminSupabase();
  const removed = await admin.from("platform_news").delete().eq("id", id);
  if (removed.error) throw new Error(removed.error.message);
}
