export type AnnouncementKind = "text" | "image" | "both";

export type Announcement = {
  id: string;
  kind: AnnouncementKind;
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  isActive: boolean;
  oncePerUser: boolean;
};

// Gli annunci «una sola volta» già visti stanno sull'account (app_metadata di Supabase Auth, che
// scrive solo il server): così valgono su ogni telefono, computer o browser.
export const SEEN_ANNOUNCEMENTS_KEY = "seen_announcements";
// L'elenco viaggia nel cookie di accesso: si tengono solo gli ultimi.
export const SEEN_ANNOUNCEMENTS_MAX = 20;

export function seenAnnouncements(metadata: Record<string, unknown> | null | undefined): string[] {
  const list = metadata?.[SEEN_ANNOUNCEMENTS_KEY];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

/** Il nuovo elenco da salvare, oppure null se quell'annuncio risulta già visto. */
export function withSeenAnnouncement(metadata: Record<string, unknown> | null | undefined, id: string) {
  const seen = seenAnnouncements(metadata);
  return seen.includes(id) ? null : [...seen, id].slice(-SEEN_ANNOUNCEMENTS_MAX);
}

export function unseenAnnouncements(items: Announcement[], metadata: Record<string, unknown> | null | undefined) {
  const seen = new Set(seenAnnouncements(metadata));
  return items.filter((item) => !item.oncePerUser || !seen.has(item.id));
}

/**
 * La coda a video: aggiunge le novità senza togliere quello che si sta leggendo (dopo che è stato
 * segnato come visto il server non lo manda più) e senza riproporre ciò che è già stato chiuso.
 */
export function queueAnnouncements(queue: Announcement[], items: Announcement[], closed: ReadonlySet<string>) {
  const fresh = items.filter((item) => !closed.has(item.id) && !queue.some((queued) => queued.id === item.id));
  return fresh.length > 0 ? [...queue, ...fresh] : queue;
}
