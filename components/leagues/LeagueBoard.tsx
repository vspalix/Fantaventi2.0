"use client";

import { useEffect, useState } from "react";

type FeedItem = {
  id: string;
  kind: string;
  body: string;
  payload: { bars?: { name: string; points: number }[] } | null;
  created_at: string;
};

type BadgeItem = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  created_at: string;
};

export function LeagueBoard({ leagueId }: { leagueId: string }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [badges, setBadges] = useState<BadgeItem[]>([]);
  const [ready, setReady] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch(`/api/leagues/${leagueId}/feed`);
        const body = (await response.json()) as { items?: FeedItem[]; badges?: BadgeItem[]; ready?: boolean; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Bacheca non disponibile.");
        if (!stop) {
          setItems(body.items ?? []);
          setBadges(body.badges ?? []);
          setReady(body.ready !== false);
          setError(null);
        }
      } catch (reason) {
        if (!stop) setError(reason instanceof Error ? reason.message : "Bacheca non disponibile.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [leagueId]);

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Pagelle della lega</h2>
        {!ready ? <p>Per la bacheca esegui engagement.sql nell&apos;editor SQL di Supabase.</p> : null}
        {badges.length === 0 ? <p>I badge arrivano a fine giornata: Pollo, Re dei Bonus e Rigorista Maledetto.</p> : (
          <div className="row">
            {badges.map((badge) => (
              <article className="badge-card" key={badge.id}>
                <strong>{badge.title}</strong>
                <p>{badge.detail}</p>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="card stack">
        <h2>Bacheca</h2>
        {error ? <p className="banner">{error}</p> : null}
        {items.length === 0 ? <p>Ancora nessun movimento, risultato o sfottò.</p> : items.map((item) => {
          const bars = item.payload?.bars ?? [];
          const max = Math.max(1, ...bars.map((bar) => bar.points));
          return (
            <article className="feed-item" key={item.id}>
              <p>{item.body}</p>
              <p className="small muted">{new Date(item.created_at).toLocaleString("it-IT")}</p>
              {bars.length > 0 ? (
                <div className="stack">
                  {bars.map((bar) => (
                    <div className="bar-row" key={bar.name}>
                      <span>{bar.name}</span>
                      <span className="bar"><span style={{ width: `${Math.max(8, (bar.points / max) * 100)}%` }} /></span>
                      <strong>{bar.points}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
