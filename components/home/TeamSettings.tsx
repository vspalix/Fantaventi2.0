"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamLook } from "@/lib/server/team-look";
import { readableError } from "@/lib/feedback";

export function TeamSettings({ look }: { look: TeamLook }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(look.name);
  const [primary, setPrimary] = useState(look.primary);
  const [secondary, setSecondary] = useState(look.secondary);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setNote(null);
    setError(null);
    try {
      const form = new FormData();
      form.set("name", name);
      form.set("primary", primary);
      form.set("secondary", secondary);
      if (file) form.set("file", file);
      const response = await fetch("/api/team-look", { method: "POST", body: form });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setNote("Nome, colori e logo salvati.");
      setFile(null);
      router.refresh();
    } catch (reason) {
      setError(readableError(reason, "Salvataggio non riuscito."));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button className="hero-settings" type="button" onClick={() => setOpen(true)}>Impostazioni</button>
      {open ? (
        <div className="team-sheet" role="dialog" aria-label="Impostazioni squadra">
          <div className="team-sheet-card">
            <div className="team-sheet-head">
              <h2>Impostazioni squadra</h2>
              <button className="ghost" type="button" onClick={() => setOpen(false)}>Chiudi</button>
            </div>
            <label>Nome squadra<input value={name} maxLength={28} onChange={(event) => setName(event.target.value)} /></label>
            <div className="team-colors">
              <label>Colore principale<input type="color" value={primary} onChange={(event) => setPrimary(event.target.value)} /></label>
              <label>Colore secondario<input type="color" value={secondary} onChange={(event) => setSecondary(event.target.value)} /></label>
            </div>
            <label>Logo<input type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
            <p className="small muted">PNG o JPEG entro 2 MB. Nome e immagine vengono rifiutati se contengono volgarità o un contenuto esplicito.</p>
            {note ? <p className="small">{note}</p> : null}
            {error ? <p className="banner">{error}</p> : null}
            <button className="primary" type="button" disabled={pending} onClick={() => void save()}>{pending ? "Salvataggio..." : "Salva"}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
