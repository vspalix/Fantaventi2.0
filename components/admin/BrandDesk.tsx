"use client";

import { useState } from "react";
import { DEFAULT_BRAND_ACCENT, DEFAULT_ICON_192, DEFAULT_ICON_512, type BrandSettings } from "@/lib/brand";

type Slot = "logo" | "icon192" | "icon512";

export function BrandDesk({ initial }: { initial: BrandSettings }) {
  const [brand, setBrand] = useState(initial);
  const [accent, setAccent] = useState(initial.accentColor || DEFAULT_BRAND_ACCENT);
  const [preview, setPreview] = useState<Partial<Record<Slot, string>>>({});
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function show(next: BrandSettings, message: string) {
    setBrand(next);
    setAccent(next.accentColor);
    setNote(message);
    setError(null);
  }

  async function upload(slot: Slot, file: File) {
    const local = URL.createObjectURL(file);
    setPreview((current) => ({ ...current, [slot]: local }));
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const body = new FormData();
      body.set("slot", slot);
      body.set("file", file);
      const response = await fetch("/api/admin/brand", { method: "POST", body });
      const payload = await response.json() as { brand?: BrandSettings; error?: string };
      if (!response.ok || !payload.brand) throw new Error(payload.error ?? "Caricamento non riuscito.");
      show(payload.brand, "Immagine pubblicata.");
      setPreview((current) => ({ ...current, [slot]: undefined }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Caricamento non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAccent() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accentColor: accent }),
      });
      const payload = await response.json() as { brand?: BrandSettings; error?: string };
      if (!response.ok || !payload.brand) throw new Error(payload.error ?? "Colore non salvato.");
      show(payload.brand, "Colore di accento aggiornato.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Colore non salvato.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm("Ripristinare logo, icone e colore ai valori di default?")) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const payload = await response.json() as { brand?: BrandSettings; error?: string };
      if (!response.ok || !payload.brand) throw new Error(payload.error ?? "Ripristino non riuscito.");
      setPreview({});
      show(payload.brand, "Valori di default ripristinati.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ripristino non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  const logo = preview.logo || brand.logoUrl;
  const icon192 = preview.icon192 || brand.icon192Url || DEFAULT_ICON_192;
  const icon512 = preview.icon512 || brand.icon512Url || DEFAULT_ICON_512;

  return (
    <div className="stack">
      {!brand.ready ? <p className="banner">Esegui supabase/brand_storage.sql nell&apos;editor SQL.</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}

      <section className="card stack">
        <h2>Logo principale</h2>
        <p className="small muted">Header, accesso e locandina della giornata. PNG, SVG o WebP, entro 2 MB.</p>
        <img className="brand-preview" src={logo || DEFAULT_ICON_192} alt="Anteprima logo" />
        <label>
          Carica logo
          <input type="file" accept="image/png,image/svg+xml,image/webp" disabled={busy} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload("logo", file);
          }} />
        </label>
      </section>

      <section className="card stack">
        <h2>Icona app e PWA</h2>
        <p className="small muted">Se un campo resta vuoto, l&apos;app usa le icone locali.</p>
        <div className="row">
          <div className="stack">
            <img className="brand-preview" src={icon192} alt="Anteprima 192" />
            <label>
              192×192
              <input type="file" accept="image/png,image/svg+xml,image/webp" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload("icon192", file);
              }} />
            </label>
          </div>
          <div className="stack">
            <img className="brand-preview" src={icon512} alt="Anteprima 512" />
            <label>
              512×512
              <input type="file" accept="image/png,image/svg+xml,image/webp" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload("icon512", file);
              }} />
            </label>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>Colore di accento</h2>
        <div className="row">
          <label>
            Colore
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_BRAND_ACCENT} onChange={(event) => setAccent(event.target.value)} />
          </label>
          <label>
            Hex
            <input value={accent} onChange={(event) => setAccent(event.target.value)} spellCheck={false} />
          </label>
        </div>
        <p className="small">Anteprima <span className="brand-swatch" style={{ background: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_BRAND_ACCENT }} /></p>
        <div className="row">
          <button className="primary" type="button" disabled={busy || !brand.ready} onClick={() => void saveAccent()}>Salva colore</button>
          <button className="ghost" type="button" disabled={busy || !brand.ready} onClick={() => void reset()}>Ripristina default</button>
        </div>
      </section>
    </div>
  );
}
