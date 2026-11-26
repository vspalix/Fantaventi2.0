"use client";

import { useState } from "react";

type Settings = {
  votesSourceUrl: string;
  votesProvider: string;
  apiSportsLeagueId: number;
  apiSportsSeason: number;
  syncWindowPostMatchMin: number;
  syncWindowPostMatchMax: number;
  syncWindowEveningStart: string;
  syncWindowEveningEnd: string;
  syncWindowMorningStart: string;
  syncWindowMorningEnd: string;
  autoSyncEnabled: boolean;
  notifyOnSyncSuccess: boolean;
  halftimeReadEnabled: boolean;
  ready: boolean;
};

type LogRow = {
  id: string;
  createdAt: string;
  jobType: "votes" | "availability" | "kickoffs";
  triggerSource: "cron" | "manual";
  status: "success" | "skipped" | "error";
  recordsWritten: number;
  message: string;
};

const JOB = { votes: "Voti", availability: "Indisponibili", kickoffs: "Orari" };
const ORIGIN = { cron: "Cron", manual: "Manuale" };
const STATUS = { success: "Ok", skipped: "Saltato", error: "Errore" };

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" }).format(date);
}

function describe(body: Record<string, unknown>) {
  if (typeof body.error === "string") return body.error;
  if (typeof body.reason === "string") return body.reason;
  if (Array.isArray(body.synced)) {
    const errors = Array.isArray(body.errors) ? body.errors.length : 0;
    return errors ? `Aggiornati ${body.synced.length} incontri, con ${errors} errori.` : `Aggiornati ${body.synced.length} incontri.`;
  }
  return "Operazione conclusa.";
}

export function SyncDesk({ initial, initialLogs }: { initial: Settings; initialLogs: LogRow[] }) {
  const [settings, setSettings] = useState(initial);
  const [logs, setLogs] = useState(initialLogs);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(next: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...next }));
  }

  async function reloadLogs() {
    const response = await fetch("/api/admin/sync-settings");
    const body = await response.json() as { logs?: LogRow[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Log non disponibili.");
    setLogs(body.logs ?? []);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/sync-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json() as { settings?: Settings; notice?: string | null; error?: string };
      if (!response.ok || !body.settings) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setSettings(body.settings);
      setNote(body.notice || "Configurazione salvata.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTestAlert() {
    setBusy(true);
    setError(null);
    setNote(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/telegram-test", { method: "POST" });
      const body = await response.json() as { ok?: boolean; error?: string; warning?: string | null };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Messaggio di prova non inviato.");
      setNote(body.warning ? `Messaggio di prova inviato. ${body.warning}` : "Messaggio di prova inviato su Telegram.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Messaggio di prova non inviato.");
    } finally {
      setBusy(false);
    }
  }

  async function sendErrorTest() {
    setBusy(true);
    setError(null);
    setNote(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/telegram-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "error" }),
      });
      const body = await response.json() as { ok?: boolean; outcome?: string; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Avviso di prova non inviato.");
      setNote(body.outcome === "grouped"
        ? "Nessun nuovo messaggio: un avviso di prova è già partito nell'ultima ora."
        : "Avviso di errore finto inviato su Telegram.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Avviso di prova non inviato.");
    } finally {
      setBusy(false);
    }
  }

  async function force(kind: "votes" | "availability") {
    const label = kind === "votes" ? "i voti" : "gli indisponibili";
    if (!window.confirm(`Forzare adesso la sincronizzazione di ${label}? Parte subito e contatta la fonte, anche fuori orario.`)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const path = kind === "votes" ? "/api/cron/sync-match-votes" : "/api/cron/sync-availability";
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Sync non riuscito.");
      setResult(describe(body));
      await reloadLogs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {!settings.ready ? <p className="banner">Esegui supabase/system_settings.sql nell&apos;editor SQL.</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
      {result ? <p className="banner ok">{result}</p> : null}

      <section className="card stack">
        <h2>Sincronizzazione automatica</h2>
        <label className="check-line">
          <input
            type="checkbox"
            checked={settings.autoSyncEnabled}
            onChange={(event) => patch({ autoSyncEnabled: event.target.checked })}
          />
          Attiva i giri automatici di voti e indisponibili
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={settings.notifyOnSyncSuccess}
            onChange={(event) => patch({ notifyOnSyncSuccess: event.target.checked })}
          />
          Notifica Telegram con riepilogo anche a ogni sincronizzazione riuscita (Modalità Test)
        </label>
      </section>

      <section className="card stack">
        <h2>Sorgente voti</h2>
        <label>
          Provider
          <select value={settings.votesProvider === "custom" ? "custom" : "fantacalcio"} onChange={(event) => patch({ votesProvider: event.target.value })}>
            <option value="fantacalcio">Fantacalcio</option>
            <option value="custom">Custom URL</option>
          </select>
        </label>
        <label>
          URL base
          <input value={settings.votesSourceUrl} onChange={(event) => patch({ votesSourceUrl: event.target.value })} inputMode="url" />
        </label>
        <p className="small muted">Alla base si aggiungono stagione e numero di giornata, per esempio /2026-27/11.</p>
      </section>

      <section className="card stack">
        <h2>Sorgente indisponibili</h2>
        <label>
          Provider
          <select value="api-sports">
            <option value="api-sports">API-Sports</option>
          </select>
        </label>
        <div className="row">
          <label>League ID<input type="number" value={settings.apiSportsLeagueId} onChange={(event) => patch({ apiSportsLeagueId: Number(event.target.value) })} /></label>
          <label>Stagione<input type="number" value={settings.apiSportsSeason} onChange={(event) => patch({ apiSportsSeason: Number(event.target.value) })} /></label>
        </div>
      </section>

      <section className="card stack">
        <h2>Letture dei voti</h2>
        <label className="check-line">
          <input
            type="checkbox"
            checked={settings.halftimeReadEnabled}
            onChange={(event) => patch({ halftimeReadEnabled: event.target.checked })}
          />
          Leggi anche a fine primo tempo
        </label>
        <p className="small muted">
          Fine primo tempo: 50 minuti dopo il calcio d&apos;inizio. Fine partita: 120 minuti dopo. Dopo l&apos;ultima partita del turno:
          alle 08:00 del giorno seguente, poi il calcolo (dalla giornata 12) solo con voti completi.
          Le partite in contemporanea condividono la lettura. Ogni lettura ha un solo nuovo tentativo, poi arriva un avviso Telegram.
          Orari di Roma. Il calendario si rilegge ogni giorno alle 08:00.
        </p>
        <button className="primary" type="button" disabled={busy || !settings.ready} onClick={() => void save()}>Salva configurazione</button>
      </section>

      <section className="card stack">
        <h2>Controllo manuale</h2>
        <p className="small muted">Parte subito, anche fuori orario. Scrive i voti ufficiali e calcola solo dalle 08:00 successive al turno e con voti completi.</p>
        <div className="row">
          <button className="ghost" type="button" disabled={busy} onClick={() => void force("votes")}>Forza sync voti ora</button>
          <button className="ghost" type="button" disabled={busy} onClick={() => void force("availability")}>Forza sync indisponibili ora</button>
        </div>
        <p className="small muted">Con la modalità test accesa, Telegram manda un riepilogo anche quando voti, indisponibili o orari cambiano davvero. Gli errori arrivano comunque. I giri saltati e quelli senza variazioni restano muti.</p>
        <p><a href="/admin/laboratorio/diagnostica">Apri la diagnostica</a></p>
        <button className="ghost" type="button" disabled={busy} onClick={() => void sendTestAlert()}>Invia Test Alert</button>
        <button className="ghost" type="button" disabled={busy} onClick={() => void sendErrorTest()}>Prova un avviso di errore</button>
        <p className="small muted">La prova non tocca il database: simula un errore con dati inventati. Parte al massimo un avviso all&apos;ora.</p>
      </section>

      <section className="card stack">
        <div className="row">
          <h2>Storico sincronizzazioni</h2>
          <button className="ghost" type="button" disabled={busy} onClick={() => void reloadLogs().catch((cause) => setError(cause instanceof Error ? cause.message : "Log non disponibili."))}>Aggiorna log</button>
        </div>
        {logs.length === 0 ? <p className="small muted">Nessun giro registrato.</p> : null}
        <ul className="sync-log">
          {logs.map((row) => (
            <li key={row.id}>
              <div className="row">
                <span className="sync-badge" data-status={row.status}>{STATUS[row.status]}</span>
                <strong>{JOB[row.jobType]}</strong>
                <span className="small muted">{ORIGIN[row.triggerSource]}</span>
                <span className="small muted">{when(row.createdAt)}</span>
              </div>
              <p className="small">{row.message || "Nessun dettaglio."}{row.recordsWritten ? ` · ${row.recordsWritten} record` : ""}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
