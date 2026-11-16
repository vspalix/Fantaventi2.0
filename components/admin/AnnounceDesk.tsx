"use client";

import { useEffect, useState } from "react";
import type { AnnouncementKind } from "@/lib/announcements";

type Row = {
  id: string;
  kind: AnnouncementKind;
  title: string | null;
  body: string | null;
  isActive: boolean;
  oncePerUser: boolean;
};

export function AnnounceDesk() {
  const [rows, setRows] = useState<Row[]>([]);
  const [kind, setKind] = useState<AnnouncementKind>("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaHref, setCtaHref] = useState("");
  const [oncePerUser, setOncePerUser] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const response = await fetch("/api/admin/announcements");
    const body = await response.json() as { announcements?: Row[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Elenco non disponibile.");
    setRows(body.announcements ?? []);
  }

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Elenco non disponibile."));
  }, []);

  function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 120000) {
      setError("Il file supera i 120 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageUrl(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title, text, imageUrl, ctaLabel, ctaHref, oncePerUser, isActive: true }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setTitle("");
      setText("");
      setImageUrl("");
      setCtaLabel("");
      setCtaHref("");
      setNote("Annuncio attivo. Compare al prossimo ingresso.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: Row) {
    setRows((list) => list.map((item) => item.id === row.id ? { ...item, isActive: !item.isActive } : item));
    await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggle: true, id: row.id, isActive: !row.isActive }),
    });
  }

  return (
    <div className="stack">
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
      <section className="card stack">
        <label>
          Tipo
          <select value={kind} onChange={(event) => setKind(event.target.value as AnnouncementKind)}>
            <option value="text">Solo testo</option>
            <option value="image">Solo locandina</option>
            <option value="both">Immagine, testo e pulsante</option>
          </select>
        </label>
        {kind !== "image" ? (
          <>
            <label>Titolo<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Testo<textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} /></label>
          </>
        ) : null}
        {kind !== "text" ? (
          <>
            <label>Immagine https<input type="url" value={imageUrl.startsWith("data:") ? "" : imageUrl} onChange={(event) => setImageUrl(event.target.value)} /></label>
            <label>File<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onFile(event.target.files?.[0])} /></label>
          </>
        ) : null}
        {kind === "both" ? (
          <>
            <label>Testo del pulsante<input value={ctaLabel} onChange={(event) => setCtaLabel(event.target.value)} /></label>
            <label>Link del pulsante<input type="url" value={ctaHref} onChange={(event) => setCtaHref(event.target.value)} /></label>
          </>
        ) : null}
        <label className="check">
          <input type="checkbox" checked={oncePerUser} onChange={(event) => setOncePerUser(event.target.checked)} />
          Una sola volta per utente
        </label>
        <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Salvo..." : "Pubblica"}</button>
      </section>
      <section className="card stack">
        <h2>Annunci</h2>
        {rows.length === 0 ? <p>Nessun annuncio.</p> : rows.map((row) => (
          <div className="row" key={row.id}>
            <strong>{row.title || (row.kind === "image" ? "Locandina" : "Avviso")}</strong>
            <button className="ghost" type="button" onClick={() => void toggle(row)}>{row.isActive ? "Attivo" : "Spento"}</button>
          </div>
        ))}
      </section>
    </div>
  );
}
