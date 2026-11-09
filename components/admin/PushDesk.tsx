"use client";

import { useEffect, useState } from "react";

type Template = { kind: string; title: string; body: string; enabled: boolean };

const LABELS: Record<string, string> = {
  deadline: "30 minuti prima della deadline",
  bonus: "Gol, assist o rigore parato",
  overtake: "Sorpasso o ribaltone live",
};

export function PushDesk() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [subscribers, setSubscribers] = useState(0);
  const [ready, setReady] = useState(true);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/push")
      .then(async (response) => {
        const body = (await response.json()) as { templates?: Template[]; subscribers?: number; ready?: boolean; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Pannello non disponibile.");
        setTemplates(body.templates ?? []);
        setSubscribers(body.subscribers ?? 0);
        setReady(body.ready !== false);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Pannello non disponibile."));
  }, []);

  async function saveTemplates() {
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setNote("Testi salvati. I segnaposto sono {matchday}, {player}, {event}, {opponent}.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setPending(false);
    }
  }

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
      const body = (await response.json()) as { sent?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Invio non riuscito.");
      setNote(`Inviata a ${body.sent ?? 0} dispositivi.`);
      setTitle("");
      setMessage("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invio non riuscito.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      {!ready ? <p className="banner">Esegui engagement.sql nell&apos;editor SQL di Supabase.</p> : null}
      <section className="card stack">
        <h2>Invia una notifica</h2>
        <p className="small muted">Arriva a chi ha attivato le notifiche. Dispositivi iscritti: {subscribers}.</p>
        <label>
          Titolo
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Testo
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} />
        </label>
        <button className="primary" type="button" disabled={pending} onClick={() => void send()}>Invia ora</button>
      </section>
      <section className="card stack">
        <h2>Notifiche automatiche</h2>
        {templates.map((template, index) => (
          <div className="stack" key={template.kind}>
            <label className="row">
              <input
                type="checkbox"
                checked={template.enabled}
                onChange={(event) => setTemplates((current) => current.map((item, itemIndex) => (
                  itemIndex === index ? { ...item, enabled: event.target.checked } : item
                )))}
              />
              {LABELS[template.kind] ?? template.kind}
            </label>
            <input
              value={template.title}
              onChange={(event) => setTemplates((current) => current.map((item, itemIndex) => (
                itemIndex === index ? { ...item, title: event.target.value } : item
              )))}
            />
            <textarea
              rows={2}
              value={template.body}
              onChange={(event) => setTemplates((current) => current.map((item, itemIndex) => (
                itemIndex === index ? { ...item, body: event.target.value } : item
              )))}
            />
          </div>
        ))}
        <button className="ghost" type="button" disabled={pending || templates.length === 0} onClick={() => void saveTemplates()}>Salva i testi</button>
      </section>
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
    </div>
  );
}
