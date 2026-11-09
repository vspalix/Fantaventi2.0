"use client";

import { useEffect, useState } from "react";

export function MaintenanceSwitch() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/maintenance")
      .then(async (response) => {
        const body = (await response.json()) as { enabled?: boolean; message?: string; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Interruttore non disponibile.");
        setEnabled(Boolean(body.enabled));
        setMessage(body.message ?? "");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Interruttore non disponibile."));
  }, []);

  async function save(next: boolean) {
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, message }),
      });
      const body = (await response.json()) as { enabled?: boolean; message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setEnabled(Boolean(body.enabled));
      setMessage(body.message ?? message);
      setNote(body.enabled ? "Gli utenti non possono più inviare formazioni né cambiare rosa." : "Scritture di nuovo aperte.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Manutenzione</h2>
      <p className="small muted">Durante il calcolo della domenica chiudi le scritture. La consultazione resta aperta.</p>
      <label>
        Messaggio
        <textarea rows={2} value={message} onChange={(event) => setMessage(event.target.value)} />
      </label>
      <button className={enabled ? "ghost" : "primary"} type="button" disabled={pending} onClick={() => void save(!enabled)}>
        {enabled ? "Riapri formazioni e mercati" : "Attiva sola lettura"}
      </button>
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
    </section>
  );
}
