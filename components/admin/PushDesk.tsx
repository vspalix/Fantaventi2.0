"use client";

import { useEffect, useState } from "react";
import { readableError } from "@/lib/feedback";
import { ReminderCard, type ReminderPreview } from "@/components/admin/ReminderCard";
import { EDITABLE_KINDS, NOTIFICATION_INFO, type NotificationTemplate } from "@/lib/notification-templates";

type DeskData = { templates: NotificationTemplate[]; subscribers: number; ready: boolean };

async function loadDesk(): Promise<DeskData> {
  const response = await fetch("/api/admin/push");
  const body = (await response.json().catch(() => ({}))) as Partial<DeskData> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Pagina non disponibile. Ricarica tra poco.");
  return { templates: body.templates ?? [], subscribers: body.subscribers ?? 0, ready: body.ready !== false };
}

function devices(count: number) {
  return count === 1 ? "1 dispositivo" : `${count} dispositivi`;
}

/** Pagina Admin › Notifiche: messaggio a tutti e avvisi automatici. */
export function PushDesk({ reminder }: { reminder: ReminderPreview | null }) {
  const [data, setData] = useState<DeskData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadDesk().then(setData).catch((reason: unknown) => setLoadError(readableError(reason, "Pagina non disponibile.")));
  }, []);

  if (loadError) return <p className="banner">{loadError}</p>;
  if (!data) return <p className="small muted">Caricamento…</p>;
  return (
    <div className="stack">
      <Broadcast subscribers={data.subscribers} onSent={() => void loadDesk().then(setData).catch(() => undefined)} />
      <ReminderCard initial={reminder} />
      <AutoAlerts initial={data.templates.filter((item) => EDITABLE_KINDS.includes(item.kind))} ready={data.ready} />
    </div>
  );
}

function Broadcast({ subscribers, onSent }: { subscribers: number; onSent: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const complete = title.trim().length >= 2 && message.trim().length >= 2;

  async function send() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, message }),
      });
      const body = (await response.json().catch(() => ({}))) as { sent?: number; skipped?: number; removed?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Invio non riuscito.");
      const missed = body.skipped ? ` Non raggiunti: ${devices(body.skipped)}${body.removed ? ` (${body.removed} non più validi, tolti dall'elenco)` : ""}.` : "";
      setNote(`Inviato a ${devices(body.sent ?? 0)}.${missed}`);
      setTitle("");
      setMessage("");
      setConfirming(false);
      onSent();
    } catch (reason) {
      setError(readableError(reason, "Invio non riuscito."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Messaggio a tutti</h2>
      <p className="small muted">Arriva subito a chi ha attivato le notifiche: oggi {devices(subscribers)}.</p>
      <label>
        Titolo
        <input
          value={title}
          maxLength={60}
          placeholder="Es. Giornata rinviata"
          onChange={(event) => { setTitle(event.target.value); setConfirming(false); setNote(null); }}
        />
      </label>
      <label>
        Messaggio
        <textarea
          value={message}
          maxLength={200}
          rows={3}
          placeholder="Es. La 14ª giornata si gioca martedì: formazioni aperte fino alle 18."
          onChange={(event) => { setMessage(event.target.value); setConfirming(false); setNote(null); }}
        />
      </label>
      {confirming ? (
        <div className="stack">
          <p className="banner">Inviare ora a {devices(subscribers)}? Non si può annullare.</p>
          <div className="row">
            <button className="primary" type="button" disabled={pending} onClick={() => void send()}>
              {pending ? "Invio…" : "Sì, invia"}
            </button>
            <button className="ghost" type="button" disabled={pending} onClick={() => setConfirming(false)}>Annulla</button>
          </div>
        </div>
      ) : (
        <button className="primary" type="button" disabled={!complete || subscribers === 0} onClick={() => setConfirming(true)}>
          Invia a tutti
        </button>
      )}
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
    </section>
  );
}

function AutoAlerts({ initial, ready }: { initial: NotificationTemplate[]; ready: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(items) !== JSON.stringify(saved);

  function change(index: number, patch: Partial<NotificationTemplate>) {
    setNote(null);
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function save() {
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: items }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setSaved(items);
      setNote("Avvisi salvati.");
    } catch (reason) {
      setError(readableError(reason, "Salvataggio non riuscito."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Avvisi durante le partite</h2>
      <p className="small muted">Durante le partite, solo a chi riguardano. Spegni quelli che non vuoi e, se serve, cambia il testo.</p>
      {!ready ? <p className="banner">Questi avvisi non si possono modificare: manca la tabella nel database.</p> : null}
      {items.map((item, index) => {
        const info = NOTIFICATION_INFO[item.kind];
        return (
          <div className="stack push-alert" key={item.kind}>
            <label className="lg-switch">
              <span className="lg-choice-text">
                <strong>{info.label}</strong>
                <small>{info.when}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={item.enabled}
                disabled={!ready}
                onChange={(event) => change(index, { enabled: event.target.checked })}
              />
            </label>
            {item.enabled ? (
              <>
                <label>
                  Titolo
                  <input value={item.title} maxLength={60} disabled={!ready} onChange={(event) => change(index, { title: event.target.value })} />
                </label>
                <label>
                  Testo
                  <textarea value={item.body} maxLength={200} rows={2} disabled={!ready} onChange={(event) => change(index, { body: event.target.value })} />
                </label>
                <p className="small muted push-words">
                  Si riempiono da sole:{" "}
                  {info.words.map(([word, meaning], wordIndex) => (
                    <span key={word}>{wordIndex > 0 ? " · " : ""}<code>{word}</code> {meaning}</span>
                  ))}
                </p>
              </>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
      <div className="row">
        <button className="primary" type="button" disabled={!ready || !changed || pending} onClick={() => void save()}>
          {pending ? "Salvataggio…" : "Salva le modifiche"}
        </button>
        {changed ? (
          <button className="ghost" type="button" disabled={pending} onClick={() => { setItems(saved); setError(null); }}>Annulla</button>
        ) : null}
      </div>
    </section>
  );
}
