"use client";

import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/announcements";
import { nativeShare, triggerHaptic } from "@/lib/native/bridge";

const STORAGE = "fv-announcement-seen";

function seenIds() {
  try {
    const raw = window.localStorage.getItem(STORAGE);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function AnnounceModal({ items }: { items: Announcement[] }) {
  const [queue, setQueue] = useState<Announcement[]>([]);

  useEffect(() => {
    const seen = seenIds();
    setQueue(items.filter((item) => !item.oncePerUser || !seen.has(item.id)));
  }, [items]);

  const current = queue[0];
  if (!current) return null;

  function close() {
    if (current.oncePerUser) {
      const seen = seenIds();
      seen.add(current.id);
      window.localStorage.setItem(STORAGE, JSON.stringify([...seen]));
    }
    setQueue((list) => list.slice(1));
  }

  return (
    <div className="announce-backdrop" role="presentation">
      <section className="announce-modal" role="dialog" aria-modal="true" aria-label={current.title ?? "Annuncio"}>
        <button className="announce-close" type="button" aria-label="Chiudi" onClick={close}>×</button>
        {current.imageUrl ? <img src={current.imageUrl} alt={current.title ?? ""} /> : null}
        {current.title ? <h2>{current.title}</h2> : null}
        {current.body ? <p>{current.body}</p> : null}
        {current.imageUrl ? (
          <button
            className="ghost"
            type="button"
            onClick={() => {
              void (async () => {
                const result = await nativeShare({
                  title: current.title || "FantaVenti",
                  text: current.body ?? undefined,
                  url: current.imageUrl ?? undefined,
                });
                if (result === "shared" || result === "copied") void triggerHaptic();
              })();
            }}
          >
            Condividi locandina
          </button>
        ) : null}
        {current.ctaHref ? (
          <a className="primary" href={current.ctaHref} target="_blank" rel="noreferrer">{current.ctaLabel || "Apri"}</a>
        ) : null}
      </section>
    </div>
  );
}
