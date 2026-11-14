"use client";

import { useEffect, useRef, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import type { LiveDiagnostics } from "@/lib/server/live-diagnostics";

const when = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" });

function stamp(value: string | null) {
  if (!value) return "Mai";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : when.format(date);
}

export function LiveSyncDesk() {
  const [status, setStatus] = useState<LiveDiagnostics | null>(null);
  const [leagueId, setLeagueId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);

  async function load(nextLeagueId = leagueId) {
    const query = nextLeagueId ? `?leagueId=${encodeURIComponent(nextLeagueId)}` : "";
    const response = await fetch(`/api/admin/live-status${query}`);
    const body = (await response.json()) as LiveDiagnostics & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Diagnostica non disponibile.");
    setStatus(body);
    if (!nextLeagueId && body.leagues[0]) setLeagueId(body.leagues[0].id);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Diagnostica non disponibile."));
  }, []);

  async function force() {
    if (flight.current) return;
    const confirmed = window.confirm("Forzare sincronismo calendario, import voti e ricalcolo della giornata corrente sul binario Serie A? Le leghe sandbox non entrano in questo calcolo.");
    if (!confirmed) return;
    flight.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/live-status", { method: "POST" });
      const body = (await response.json()) as {
        error?: string;
        gameweekNumber?: number | null;
        calendarError?: string | null;
        votes?: { synced: unknown[]; errors: { message: string }[] };
        score?: { teams?: number; skipped?: boolean; reason?: string } | null;
      };
      if (!response.ok) throw new Error(body.error ?? "Sync non riuscito.");
      const problems = [
        body.calendarError,
        ...(body.votes?.errors ?? []).map((item) => item.message),
        body.score?.skipped ? body.score.reason : null,
      ].filter(Boolean);
      setMessage(problems.length > 0
        ? `Giornata ${body.gameweekNumber ?? "—"}: ${problems.join(" ")}`
        : `Giornata ${body.gameweekNumber ?? "—"} aggiornata. Squadre calcolate: ${body.score?.teams ?? 0}. Voti sincronizzati: ${body.votes?.synced.length ?? 0}.`);
      await load(leagueId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sync non riuscito.");
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Stato Sync & Cron Live</h2>
      <p className="small muted">Binario Serie A. Legge gli ultimi passaggi di calendario e di voti, senza aprire la sandbox.</p>
      {error ? <p className="banner">{error}</p> : null}
      {message ? <p className="banner ok">{message}</p> : null}
      {status ? (
        <div className="summary-grid">
          <div className="stat">
            Calendario
            <strong>{stamp(status.calendar.at)}</strong>
            <span className="small muted">{status.calendar.provider ?? "nessuna fonte"} · {status.calendar.status ?? "—"}</span>
            {status.calendar.error ? <span className="small">{status.calendar.error}</span> : <span className="small muted">Nessun errore registrato</span>}
          </div>
          <div className="stat">
            Voti
            <strong>{stamp(status.votes.at)}</strong>
            <span className="small muted">
              {status.votes.gameweekNumber ? `Giornata ${status.votes.gameweekNumber}` : "Nessun import"} · {status.votes.imported} voti
            </span>
            {status.votes.error ? <span className="small">{status.votes.error}</span> : <span className="small muted">{status.votes.source ?? "Nessun errore registrato"}</span>}
          </div>
          <div className="stat">
            Formazioni
            <strong>{status.filing ? `${status.filing.filed}/${status.filing.teams}` : "—"}</strong>
            <span className="small muted">
              {status.filing?.leagueName ?? "Nessuna lega"}
              {status.filing?.gameweekNumber ? ` · giornata ${status.filing.gameweekNumber}` : ""}
              {status.filing ? ` · blocco ${status.filing.locked ? "attivo" : "non ancora scattato"}` : ""}
            </span>
          </div>
        </div>
      ) : <p className="small muted">Lettura dello stato in corso.</p>}
      <div className="row">
        <label>
          Lega reale
          <select
            value={leagueId}
            disabled={pending || !status}
            onChange={(event) => {
              setLeagueId(event.target.value);
              void load(event.target.value).catch((reason) => setError(reason instanceof Error ? reason.message : "Diagnostica non disponibile."));
            }}
          >
            {(status?.leagues ?? []).map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
          </select>
        </label>
        <button className="primary" type="button" disabled={pending} aria-busy={pending} onClick={() => void force()}>
          <BusyLabel pending={pending} idle="Forza Sync & Ricalcolo Giornata Corrente" busy="Sincronizzo..." />
        </button>
      </div>
    </section>
  );
}
