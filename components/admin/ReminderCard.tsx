"use client";

import { useState } from "react";
import { readableError } from "@/lib/feedback";

export type ReminderPreview = {
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

function teams(count: number) {
  return count === 1 ? "1 squadra" : `${count} squadre`;
}

function status(preview: ReminderPreview) {
  const next = preview.next;
  if (!next) return "Nessuna giornata da schierare nei prossimi 30 giorni.";
  const head = `Giornata ${next.gameweek}: chiude ${when(next.deadlineAt)}.`;
  if (next.reminded > 0) return `${head} Già avvisate ${teams(next.reminded)}.`;
  if (!preview.settings.enabled) return head;
  if (next.blocked) return `${head} Per ora niente promemoria: ${next.blocked}`;
  const missing = next.pending === null ? "" : ` Oggi senza formazione: ${teams(next.pending)}.`;
  return next.overdue ? `${head} Parte a breve.${missing}` : `${head} Parte ${when(next.momentAt)}.${missing}`;
}

/** Promemoria a chi non ha ancora schierato. Salva subito l'interruttore; le ore con «Salva». */
export function ReminderCard({ initial }: { initial: ReminderPreview | null }) {
  const [preview, setPreview] = useState(initial);
  const [hours, setHours] = useState(initial ? hoursText(initial.settings.leadMinutes) : "3");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!preview) {
    return (
      <section className="card stack">
        <h2>Promemoria formazioni</h2>
        <p className="banner">Impostazioni non disponibili. Ricarica tra poco.</p>
      </section>
    );
  }
  const ready = preview.settings.ready;
  const savedHours = hoursText(preview.settings.leadMinutes);

  async function save(enabled: boolean, text: string) {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const leadMinutes = minutesFrom(text);
      if (leadMinutes === null) throw new Error("Scrivi le ore con un numero, per esempio 3 oppure 2,5.");
      const response = await fetch("/api/admin/lineup-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, leadMinutes }),
      });
      const body = (await response.json().catch(() => ({}))) as ReminderPreview & { error?: string };
      if (!response.ok || !body.settings) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setPreview(body);
      setHours(hoursText(body.settings.leadMinutes));
      setNote(body.settings.enabled ? "Promemoria acceso." : "Promemoria spento.");
    } catch (reason) {
      setError(readableError(reason, "Salvataggio non riuscito."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Promemoria formazioni</h2>
      {!ready ? <p className="banner">Il promemoria non si può usare: manca una modifica al database.</p> : null}
      <label className="lg-switch">
        <span className="lg-choice-text">
          <strong>Avvisa chi non ha schierato</strong>
          <small>Una volta per giornata, alle ore scelte qui sotto. Se manca ancora, ultimo avviso 30 minuti prima.</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={preview.settings.enabled}
          disabled={!ready || busy}
          onChange={(event) => void save(event.target.checked, savedHours)}
        />
      </label>
      {preview.settings.enabled ? (
        <div className="row push-hours">
          <label>
            Ore prima della chiusura
            <input type="text" inputMode="decimal" value={hours} disabled={!ready || busy} onChange={(event) => { setHours(event.target.value); setNote(null); }} />
          </label>
          {hours.trim() !== savedHours ? (
            <button className="primary" type="button" disabled={busy} onClick={() => void save(true, hours)}>Salva</button>
          ) : null}
        </div>
      ) : null}
      <p className="small muted">{status(preview)}</p>
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
    </section>
  );
}
