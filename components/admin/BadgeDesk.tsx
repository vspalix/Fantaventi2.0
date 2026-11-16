"use client";

import { useEffect, useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { SERIE_A_CLUBS, type ClubBadgeOverride } from "@/lib/club-colors";

export function BadgeDesk() {
  const [rows, setRows] = useState<ClubBadgeOverride[]>(SERIE_A_CLUBS.map((club) => ({
    code: club.code,
    primary: club.colors[0],
    secondary: club.colors[1],
    logoUrl: null,
  })));
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const response = await fetch("/api/admin/club-badges");
      const body = await response.json() as { clubs?: ClubBadgeOverride[]; error?: string };
      if (cancel) return;
      if (!response.ok) {
        setError(body.error ?? "Colori non disponibili.");
        return;
      }
      if (body.clubs) setRows(body.clubs);
    })();
    return () => { cancel = true; };
  }, []);

  function patch(code: string, next: Partial<ClubBadgeOverride>) {
    setRows((current) => current.map((row) => row.code === code ? { ...row, ...next } : row));
  }

  function onFile(code: string, file: File | undefined) {
    if (!file) return;
    if (file.size > 40000) {
      setError("Il file supera i 40 KB. Scegline uno più leggero o incolla un indirizzo https.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => patch(code, { logoUrl: String(reader.result ?? "") });
    reader.readAsDataURL(file);
  }

  async function save(row: ClubBadgeOverride) {
    setBusy(row.code);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/club-badges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setNote("Salvato. Il badge si aggiorna al prossimo caricamento.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Colori sociali</h1>
        <p className="lede">Due colori o un logo piccolo per ogni club. Senza tabella SQL restano i colori ufficiali già in app.</p>
      </header>
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
      <div className="badge-desk">
        {rows.map((row) => {
          const club = SERIE_A_CLUBS.find((item) => item.code === row.code);
          return (
            <article className="badge-row" key={row.code}>
              <TeamBadge teamName={row.code} colors={[row.primary, row.secondary]} logoUrl={row.logoUrl} />
              <strong>{club?.name ?? row.code}</strong>
              <label>
                <span className="small muted">Uno</span>
                <input type="color" value={row.primary} onChange={(event) => patch(row.code, { primary: event.target.value })} />
              </label>
              <label>
                <span className="small muted">Due</span>
                <input type="color" value={row.secondary} onChange={(event) => patch(row.code, { secondary: event.target.value })} />
              </label>
              <label className="badge-logo">
                <span className="small muted">Logo</span>
                <input
                  type="url"
                  placeholder="https://"
                  value={row.logoUrl && !row.logoUrl.startsWith("data:") ? row.logoUrl : ""}
                  onChange={(event) => patch(row.code, { logoUrl: event.target.value || null })}
                />
              </label>
              <label className="badge-file">
                <span className="small muted">File</span>
                <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" onChange={(event) => onFile(row.code, event.target.files?.[0])} />
              </label>
              <button className="ghost" type="button" disabled={busy !== null} onClick={() => {
                if (!club) return;
                patch(row.code, { primary: club.colors[0], secondary: club.colors[1], logoUrl: null });
              }}>
                Ufficiali
              </button>
              <button className="primary" type="button" disabled={busy !== null} onClick={() => void save(row)}>
                {busy === row.code ? "Salvo..." : "Salva"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
