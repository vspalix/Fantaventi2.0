"use client";

import { useEffect, useRef, useState } from "react";
import { queueAnnouncements, type Announcement } from "@/lib/announcements";
import { nativeShare, triggerHaptic } from "@/lib/native/bridge";

let sending: Promise<unknown> = Promise.resolve();

// Un invio alla volta, così due annunci di fila non si sovrascrivono. Se non parte, l'annuncio
// ricompare al prossimo ingresso; i guasti del server li segnala l'API.
function markSeen(id: string) {
  sending = sending
    .then(() => fetch("/api/announcements/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    }))
    .catch(() => undefined);
}

export function AnnounceModal({ items }: { items: Announcement[] }) {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const closed = useRef(new Set<string>());

  useEffect(() => {
    setQueue((list) => queueAnnouncements(list, items, closed.current));
  }, [items]);

  const current = queue[0];
  const shownOnce = current?.oncePerUser ? current.id : null;

  // Conta come visto appena compare, anche se poi si chiude l'app senza premere la ×.
  useEffect(() => {
    if (shownOnce) markSeen(shownOnce);
  }, [shownOnce]);

  if (!current) return null;

  function close() {
    closed.current.add(current.id);
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
