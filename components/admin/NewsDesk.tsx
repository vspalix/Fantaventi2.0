"use client";

import { useEffect, useState } from "react";

type NewsItem = {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  pinned: boolean;
  published: boolean;
};

const EMPTY = { title: "", body: "", linkUrl: "", linkLabel: "", pinned: false, published: true };

export function NewsDesk() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function reload() {
    const response = await fetch("/api/admin/news");
    const body = (await response.json()) as { news?: NewsItem[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "News non disponibili.");
    setItems(body.news ?? []);
  }

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "News non disponibili."));
  }, []);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, id: editing ?? undefined }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setDraft(EMPTY);
      setEditing(null);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const response = await fetch("/api/admin/news", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Cancellazione non riuscita.");
      return;
    }
    await reload();
  }

  return (
    <section className="stack">
      <article className="card stack">
        <h2>{editing ? "Modifica news" : "Nuova news"}</h2>
        <label>
          Titolo
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <label>
          Testo
          <textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} rows={4} />
        </label>
        <label>
          Link https
          <input value={draft.linkUrl} onChange={(event) => setDraft({ ...draft, linkUrl: event.target.value })} placeholder="https://t.me/..." />
        </label>
        <label>
          Etichetta del link
          <input value={draft.linkLabel} onChange={(event) => setDraft({ ...draft, linkLabel: event.target.value })} placeholder="Apri Telegram" />
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} />
          In evidenza
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} />
          Pubblicata in home
        </label>
        <div className="row">
          <button className="primary" type="button" disabled={pending} onClick={() => void save()}>Salva</button>
          {editing ? <button type="button" onClick={() => { setEditing(null); setDraft(EMPTY); }}>Annulla</button> : null}
        </div>
        {error ? <p className="banner">{error}</p> : null}
      </article>
      <ul className="list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <p className="small muted">{item.published ? "In home" : "Bozza"}{item.pinned ? " · in evidenza" : ""}</p>
              <p>{item.body}</p>
            </div>
            <div className="row">
              <button type="button" onClick={() => {
                setEditing(item.id);
                setDraft({
                  title: item.title,
                  body: item.body,
                  linkUrl: item.linkUrl ?? "",
                  linkLabel: item.linkLabel ?? "",
                  pinned: item.pinned,
                  published: item.published,
                });
              }}>Modifica</button>
              <button className="danger" type="button" onClick={() => void remove(item.id)}>Elimina</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
