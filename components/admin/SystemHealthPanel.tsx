"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LATENCY_BUDGET_MS, type HealthOperation, type SystemHealth, type SystemStatus, type SuiteStamp } from "@/lib/system-health";

const OPERATION_LABEL: Record<HealthOperation, string> = {
  roster: "Caricamento rose",
  "lineup-save": "Salvataggio formazioni",
  "vote-fetch": "Fetch voti",
  "gameweek-calc": "Calcolo giornata",
};

function formatMs(value: number | null) {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value)} ms`;
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatChecked(iso: string) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

function suiteLine(stamp: SuiteStamp) {
  const outcome = stamp.status === "PASSED" ? "superata" : "fermata";
  return `${stamp.total} controlli, suite ${outcome}. ${stamp.passed} passati, ${stamp.failed} falliti, ${stamp.skipped} saltati.`;
}

async function readStatus() {
  const response = await fetch("/api/system-status", {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const body = (await response.json()) as SystemStatus;
  if (!body || typeof body.success !== "boolean" || !body.database) {
    throw new Error("Stato connessioni non disponibile.");
  }
  return body;
}

export function SystemHealthPanel() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const statusRequest = useRef(0);

  const load = useCallback(() => {
    const request = ++statusRequest.current;
    setStatusLoading(true);
    setError(null);
    void (async () => {
      try {
        const next = await readStatus();
        if (request !== statusRequest.current) return;
        setStatus(next);
      } catch (cause) {
        if (request !== statusRequest.current) return;
        const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
        const message = timedOut
          ? "Il controllo non ha risposto in tempo."
          : cause instanceof Error
            ? cause.message
            : "Stato connessioni non disponibile.";
        setStatus({
          success: false,
          pooler: null,
          database: { up: false, latencyMs: null, detail: message },
          error: message,
        });
      } finally {
        if (request === statusRequest.current) {
          setCheckedAt(new Date().toISOString());
          setStatusLoading(false);
        }
      }
      if (request !== statusRequest.current) return;
      try {
        const healthResponse = await fetch("/api/admin/system-health", {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "manual",
        });
        if (healthResponse.type === "opaqueredirect" || healthResponse.status === 401) {
          throw new Error("La sessione non accompagna questa richiesta. Entra di nuovo e riapri Stato sistema.");
        }
        const body = (await healthResponse.json()) as SystemHealth & { error?: string };
        if (!healthResponse.ok) throw new Error(body.error || "Stato non disponibile.");
        if (request === statusRequest.current) setHealth(body);
      } catch (cause) {
        if (request === statusRequest.current) {
          setError(cause instanceof Error ? cause.message : "Stato non disponibile.");
        }
      }
    })();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const peakBar = health ? Math.max(...health.hours.map((hour) => hour.averageMs), 1) : 1;

  return (
    <section className="stack">
      <header className="stack">
        <h2>Stato sistema</h2>
        <p>
          Corsia SQL in Transaction Mode sulla porta 6543, una connessione per processo e prepare disattivato.
          Rose, formazioni, voti e calcolo giornata lasciano qui il tempo di risposta.
        </p>
        <button className="primary" type="button" onClick={load} disabled={statusLoading}>
          {statusLoading ? "Lettura in corso…" : "Aggiorna"}
        </button>
        <p>Ultimo controllo: {checkedAt ? formatChecked(checkedAt) : "in attesa del primo controllo"}</p>
      </header>
      {error ? <p className="notice">{error}</p> : null}
      {status ? (
        <div className="health-grid">
          <article className="card stack" data-up={status.pooler?.up === true}>
            <p className="health-status">
              <span className="health-dot" data-up={status.pooler?.up === true} />
              Pooler · porta {status.pooler?.port ?? 6543} · {status.pooler?.mode ?? "transaction"}
            </p>
            <strong>{status.pooler?.up ? "Connesso" : "Fermo"}</strong>
            <p>{status.pooler?.detail ?? status.error ?? "Controllo del pooler non disponibile."}</p>
            <p>Controllo: {formatMs(status.pooler?.latencyMs ?? null)}</p>
          </article>
          <article className="card stack" data-up={status.database.up === true}>
            <p className="health-status">
              <span className="health-dot" data-up={status.database.up === true} />
              Database · leghe
            </p>
            <strong>{status.database.up ? "Connesso" : "Fermo"}</strong>
            <p>{status.database.detail}</p>
            <p>Lettura: {formatMs(status.database.latencyMs)}</p>
          </article>
        </div>
      ) : (
        <p>{statusLoading ? "Controllo di pooler e database in corso." : "I semafori arrivano da /api/system-status."}</p>
      )}
      {health ? (
        <>
          <article className="card stack">
            <h3>Latenza reale, ultime 24 ore</h3>
            <div className="test-dash">
              <p><span>Media</span><strong>{formatMs(health.averageMs)}</strong></p>
              <p><span>Picco 24 ore</span><strong>{formatMs(health.maxMs)}</strong></p>
              <p>
                <span>Picco prima del kickoff</span>
                <strong>{health.peak ? formatMs(health.peak.durationMs) : "—"}</strong>
              </p>
              <p><span>Misure</span><strong>{health.sampleCount}</strong></p>
            </div>
            {health.peak ? (
              <p>
                Il picco più alto nell&apos;ora precedente un calcio d&apos;inizio è {formatMs(health.peak.durationMs)} su {OPERATION_LABEL[health.peak.operation]}, prima delle {formatWhen(health.peak.kickoffAt)}.
              </p>
            ) : (
              <p>Nessun picco registrato nell&apos;ora prima di un calcio d&apos;inizio.</p>
            )}
            <div className="latency-chart" role="img" aria-label="Tempo medio di risposta per ogni ora delle ultime 24">
              {health.hours.map((hour) => (
                <div key={hour.from} className="latency-col" title={`${formatWhen(hour.from)} · media ${formatMs(hour.averageMs)} · ${hour.count} misure`}>
                  <span style={{ height: `${Math.max(4, (hour.averageMs / peakBar) * 100)}%` }} data-empty={hour.count === 0} />
                </div>
              ))}
            </div>
            <p className="muted">Ogni barra è la media di un&apos;ora. Il budget di sicurezza è {LATENCY_BUDGET_MS.toLocaleString("it-IT")} ms.</p>
          </article>

          <article className="card stack">
            <h3>Registro alert</h3>
            {health.alerts.length === 0 ? (
              <p>Nessuna query sopra {LATENCY_BUDGET_MS.toLocaleString("it-IT")} ms e nessun timeout di scrittura.</p>
            ) : (
              <div className="sheet-scroll">
                <table className="standings">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Operazione</th>
                      <th>Tempo</th>
                      <th>Esito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.alerts.map((alert) => (
                      <tr key={`${alert.recordedAt}-${alert.operation}-${alert.durationMs}`}>
                        <td>{formatWhen(alert.recordedAt)}</td>
                        <td>{OPERATION_LABEL[alert.operation]}</td>
                        <td>{formatMs(alert.durationMs)}</td>
                        <td>{alert.timeout ? "Timeout" : alert.ok ? "Fuori budget" : alert.detail || "Errore"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="card stack">
            <h3>Ultima esecuzione della suite</h3>
            <SuiteBlock title="Pipeline di build" stamp={health.suite.ci} empty="La build non ha ancora registrato la suite. Parte da sola prima di ogni rilascio." />
            <SuiteBlock title="Laboratorio" stamp={health.suite.admin} empty="Dal tab Test motore puoi lanciare gli stessi controlli a mano." />
          </article>
        </>
      ) : null}
    </section>
  );
}

function SuiteBlock({ title, stamp, empty }: { title: string; stamp: SuiteStamp | null; empty: string }) {
  if (!stamp) {
    return (
      <div className="stack">
        <h4>{title}</h4>
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <div className="stack">
      <h4>{title}</h4>
      <p>
        <span className="status-pill" data-status={stamp.status}>{stamp.status}</span>
        {" "}
        {formatWhen(stamp.finishedAt)}
      </p>
      <p>{suiteLine(stamp)}</p>
    </div>
  );
}
