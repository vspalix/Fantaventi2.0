"use client";

import { useEffect, useState } from "react";
import type { SponsorItem, SponsorStrip } from "@/lib/server/sponsors";

export function SponsorDesk() {
  const [strip, setStrip] = useState<SponsorStrip>({ scrollSeconds: 16, items: [] });
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin/sponsors");
      const body = await response.json() as { sponsors?: SponsorStrip; error?: string };
      if (response.ok && body.sponsors) setStrip(body.sponsors);
      else setError(body.error ?? "Striscia non disponibile.");
    })();
  }, []);

  function update(id: string, patch: Partial<SponsorItem>) {
    setStrip((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  async function upload(id: string, file: File) {
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/admin/sponsors", { method: "POST", body: form });
      const body = await response.json() as { imageUrl?: string; error?: string };
      if (!response.ok || !body.imageUrl) throw new Error(body.error ?? "Caricamento non riuscito.");
      update(id, { imageUrl: body.imageUrl });
      setNote("Logo caricato. Premi Salva per pubblicarlo in home.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Caricamento non riuscito.");
    } finally {
      setPending(false);
    }
  }

  async function save() {
    setPending(true);
    setNote(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/sponsors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strip),
      });
      const body = await response.json() as { sponsors?: SponsorStrip; error?: string };
      if (!response.ok || !body.sponsors) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setStrip(body.sponsors);
      setNote("Striscia sponsor aggiornata.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <label>
        Secondi per un giro completo
        <input
          type="number"
          min={4}
          max={90}
          value={strip.scrollSeconds}
          onChange={(event) => setStrip((current) => ({ ...current, scrollSeconds: Number(event.target.value) }))}
        />
      </label>
      {strip.items.map((item) => (
        <article className="card" key={item.id}>
          <label>Testo<input value={item.label} maxLength={48} onChange={(event) => update(item.id, { label: event.target.value })} /></label>
          <label>Link https<input value={item.href} onChange={(event) => update(item.id, { href: event.target.value })} /></label>
          {item.imageUrl ? <img className="sponsor-preview" src={item.imageUrl} alt="" /> : null}
          <label>Logo PNG o JPEG<input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(item.id, file); }} /></label>
          <button className="ghost" type="button" onClick={() => setStrip((current) => ({ ...current, items: current.items.filter((row) => row.id !== item.id) }))}>Rimuovi</button>
        </article>
      ))}
      <button
        className="ghost"
        type="button"
        onClick={() => setStrip((current) => ({ ...current, items: [...current.items, { id: crypto.randomUUID(), label: "", imageUrl: "", href: "" }] }))}
      >
        Aggiungi sponsor
      </button>
      {note ? <p className="small">{note}</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      <button className="primary" type="button" disabled={pending} onClick={() => void save()}>{pending ? "Salvataggio..." : "Salva striscia"}</button>
    </div>
  );
}
