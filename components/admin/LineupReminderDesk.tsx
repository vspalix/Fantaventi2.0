"use client";

import { useState } from "react";

type Preview = {
  settings: { enabled: boolean; leadMinutes: number; ready: boolean };
  next: {
    gameweek: number;
    deadlineAt: string;
    momentAt: string;
    overdue: boolean;
    pending: number | null;
    reminded: number;
    blocked: string | null;
  } | null;
};

const MIGRATION = "supabase/migrations/20261126180000_promemoria_formazioni.sql";

function when(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}

function hoursText(minutes: number) {
  return (minutes / 60).toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

/** «2,5», «2.5» o «3» in minuti; null se non è un numero. */
function minutesFrom(text: string) {
  const clean = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  return Math.round(Number(clean) * 60);
}

function hoursLabel(minutes: number) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} ${hours === 1 ? "ora" : "ore"}` : `${hours.toLocaleString("it-IT")} ore`;
}

function nextLine(next: NonNullable<Preview["next"]>, active: boolean) {
  const head = `Prossima chiusura: giornata ${next.gameweek}, ${when(next.deadlineAt)}.`;
  const missing = next.pending === null ? "" : ` Formazioni mancanti: ${next.pending}.`;
  if (next.reminded > 0) return `${head} Promemoria già inviato a ${next.reminded} ${next.reminded === 1 ? "squadra" : "squadre"}.${missing}`;
  if (next.blocked) return `${head} Per ora niente promemoria: ${next.blocked}`;
  if (!active) return `${head}${missing}`;
  if (next.overdue) return `${head} Il promemoria parte alla prossima sveglia.${missing}`;
  return `${head} Il promemoria parte ${when(next.momentAt)}.${missing}`;
}

export function LineupReminderDesk({ initial }: { initial: Preview }) {
  const [preview, setPreview] = useState(initial);
  const [enabled, setEnabled] = useState(initial.settings.enabled);
  const [hours, setHours] = useState(hoursText(initial.settings.leadMinutes));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = preview.settings.ready;

  async function save() {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const leadMinutes = minutesFrom(hours);
      if (leadMinutes === null) throw new Error("Scrivi le ore con un numero, per esempio 3 oppure 2,5.");
      const response = await fetch("/api/admin/lineup-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, leadMinutes }),
      });
      const body = await response.json() as Preview & { error?: string };
      if (!response.ok || !body.settings) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setPreview(body);
      setEnabled(body.settings.enabled);
      setHours(hoursText(body.settings.leadMinutes));
      setNote(body.settings.enabled ? `Promemoria acceso, ${hoursLabel(body.settings.leadMinutes)} prima della chiusura.` : "Promemoria spento.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  const next = preview.next;
  return (
    <section className="card stack">
      <h2>Promemoria formazioni</h2>
      <p className="small muted">
        Parte da solo con la sveglia dei voti, solo a chi non ha ancora consegnato, una volta per squadra e giornata.
        Se la sveglia non suona all&apos;ora giusta usa quella subito prima; se una chiamata si perde, recupera alla
        successiva, ma mai negli ultimi 5 minuti né dopo la chiusura.
      </p>
      {!ready ? (
        <p className="banner">Prima va eseguita nell&apos;editor SQL di Supabase la modifica {MIGRATION}. Fino ad allora il promemoria resta fermo.</p>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
      <label className="check-line">
        <input type="checkbox" checked={enabled} disabled={!ready || busy} onChange={(event) => setEnabled(event.target.checked)} />
        Manda il promemoria in automatico
      </label>
      <label>
        Ore prima della chiusura
        <input
          type="text"
          inputMode="decimal"
          value={hours}
          disabled={!ready || busy}
          onChange={(event) => setHours(event.target.value)}
        />
      </label>
      <p className="small muted">Da mezz&apos;ora (0,5) a 48 ore. Di partenza: 3 ore.</p>
      <button className="primary" type="button" disabled={!ready || busy} onClick={() => void save()}>Salva promemoria</button>
      {next ? <p className="small">{nextLine(next, preview.settings.enabled && ready)}</p> : (
        <p className="small muted">Nessuna giornata aperta alle formazioni nei prossimi 30 giorni.</p>
      )}
      <p className="small muted">
        Arriva come notifica a chi ha premuto «Attiva notifiche» nel sito (computer, Android, iPhone solo con il sito
        aggiunto alla schermata Home). Nell&apos;app installata dallo store non arriva ancora. A ogni invio Telegram
        riceve un riepilogo con quante persone sono state raggiunte.
      </p>
    </section>
  );
}
