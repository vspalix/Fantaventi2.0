"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PROBABILI } from "@/lib/home-links";

export function PromoDesk() {
  const [imageUrl, setImageUrl] = useState("");
  const [href, setHref] = useState("");
  const [label, setLabel] = useState("");
  const [probabiliHref, setProbabiliHref] = useState(DEFAULT_PROBABILI);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const response = await fetch("/api/admin/promo");
      const body = await response.json() as { banner?: { imageUrl: string; href: string | null; label: string | null } | null; probabiliHref?: string; error?: string };
      if (cancel || !response.ok) return;
      setImageUrl(body.banner?.imageUrl ?? "");
      setHref(body.banner?.href ?? "");
      setLabel(body.banner?.label ?? "");
      if (body.probabiliHref) setProbabiliHref(body.probabiliHref);
    })();
    return () => { cancel = true; };
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
      const response = await fetch("/api/admin/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, href, label, probabiliHref }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setNote("Salvato. Compare in home al prossimo caricamento.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
      <label>
        Immagine del banner
        <input type="url" placeholder="https://" value={imageUrl.startsWith("data:") ? "" : imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
      </label>
      <label>
        File
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onFile(event.target.files?.[0])} />
      </label>
      <label>
        Link del banner
        <input type="url" placeholder="https://" value={href} onChange={(event) => setHref(event.target.value)} />
      </label>
      <label>
        Etichetta
        <input value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} />
      </label>
      {imageUrl ? <img className="promo-preview" src={imageUrl} alt="" /> : null}
      <label>
        Probabili formazioni
        <input type="url" value={probabiliHref} onChange={(event) => setProbabiliHref(event.target.value)} />
      </label>
      <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Salvo..." : "Salva"}</button>
    </section>
  );
}
