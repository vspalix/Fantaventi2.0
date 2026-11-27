"use client";

import { useEffect, useState } from "react";
import { readableError } from "@/lib/feedback";

/** Notifica scritta a mano e inviata subito a tutti i dispositivi iscritti. Usata in Notifiche e Collaudo. */
export function PushBroadcast() {
  const [subscribers, setSubscribers] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function count() {
    const response = await fetch("/api/admin/push");
    const body = (await response.json().catch(() => ({}))) as { subscribers?: number; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Conteggio non disponibile.");
    setSubscribers(body.subscribers ?? 0);
  }

  useEffect(() => {
    count().catch((reason: unknown) => setError(readableError(reason, "Conteggio non disponibile.")));
  }, []);

  async function send() {
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, message }),
      });
      const body = (await response.json().catch(() => ({}))) as { sent?: number; skipped?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Invio non riuscito.");
      const missed = body.skipped ? ` ${body.skipped} non raggiunti (iscrizioni scadute vengono tolte).` : "";
      setNote(`Inviata a ${body.sent ?? 0} dispositivi.${missed}`);
      setTitle("");
      setMessage("");
      void count().catch(() => undefined);
    } catch (reason) {
      setError(readableError(reason, "Invio non riuscito."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Invia notifica a tutti</h2>
      <p className="small muted">Dispositivi con le notifiche attive: {subscribers ?? "…"}.</p>
      <label>
        Titolo
        <input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Testo
        <textarea value={message} maxLength={200} onChange={(event) => setMessage(event.target.value)} rows={3} />
      </label>
      <button
        className="primary"
        type="button"
        disabled={pending || title.trim().length < 2 || message.trim().length < 2}
        onClick={() => void send()}
      >
        {pending ? "Invio…" : "Invia a tutti"}
      </button>
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
    </section>
  );
}
