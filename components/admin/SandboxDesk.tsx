"use client";

import { useRef, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import type { SandboxPodiumRow, SandboxReport } from "@/lib/server/sandbox-lab";

const WEEKS = 40;

type Status = "ready" | "running" | "done" | "error";

type Report = {
  elapsedMs: number;
  weeks: number;
  checkpoints: number;
  anomalies: string[];
  teams: number;
  podium: SandboxPodiumRow[];
};

const STATUS_LABEL: Record<Status, string> = {
  ready: "Pronto",
  running: "In esecuzione",
  done: "Completato",
  error: "Interrotto",
};

export function SandboxDesk() {
  const [status, setStatus] = useState<Status>("ready");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const flight = useRef(false);
  const pending = status === "running";

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/admin/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Operazione sandbox non riuscita.");
    return payload;
  }

  async function run() {
    if (flight.current) return;
    const confirmed = window.confirm("Avviare lo stress test? Cancella la sandbox precedente, crea 100 squadre e simula 40 giornate. Le leghe reali non vengono toccate.");
    if (!confirmed) return;
    flight.current = true;
    setStatus("running");
    setError(null);
    setReport(null);
    const totals: Report = { elapsedMs: 0, weeks: 0, checkpoints: 0, anomalies: [], teams: 0, podium: [] };
    try {
      setStep("Preparo la lega e le 100 squadre.");
      await post({ action: "seed" });
      let cursor = 1;
      while (cursor) {
        setStep(`Calcolo la giornata ${Math.min(cursor, WEEKS)} di ${WEEKS}.`);
        const batch = await post({ action: "simulate", cursor, size: WEEKS }) as SandboxReport;
        totals.elapsedMs += batch.elapsedMs;
        totals.weeks += batch.weeks.length;
        totals.checkpoints += batch.checkpoints;
        totals.teams = batch.teams;
        totals.anomalies.push(...batch.anomalies);
        totals.podium = batch.podium;
        if (batch.nextCursor == null) break;
        cursor = batch.nextCursor;
      }
      setReport({ ...totals, anomalies: totals.anomalies.slice(0, 40) });
      setStep(null);
      setStatus("done");
    } catch (reason) {
      if (totals.weeks > 0) setReport({ ...totals, anomalies: totals.anomalies.slice(0, 40) });
      setError(reason instanceof Error ? reason.message : "Stress test non riuscito.");
      setStep(null);
      setStatus("error");
    } finally {
      flight.current = false;
    }
  }

  async function reset() {
    if (flight.current) return;
    const confirmed = window.confirm("Svuotare solo la sandbox? Le leghe reali restano intatte.");
    if (!confirmed) return;
    flight.current = true;
    setStatus("running");
    setStep("Svuoto la sandbox.");
    setError(null);
    setReport(null);
    try {
      await post({ action: "reset" });
      setStep(null);
      setStatus("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reset non riuscito.");
      setStep(null);
      setStatus("error");
    } finally {
      flight.current = false;
    }
  }

  return (
    <section className="card lab-panel">
      <header className="lab-head">
        <h2>Pannello di controllo</h2>
        <span className="status-pill lab-status" data-status={status}>Stato: {STATUS_LABEL[status]}</span>
      </header>
      <p className="lede">
        Un passaggio crea SANDBOX_STRESS_TEST, assegna 100 rose valide e calcola 40 giornate con il motore reale. Le leghe vere restano fuori.
      </p>
      <button className="primary lab-go" type="button" disabled={pending} aria-busy={pending && step !== "Svuoto la sandbox."} onClick={() => void run()}>
        <BusyLabel pending={pending && step !== "Svuoto la sandbox."} idle="🚀 Avvia Stress Test Completo (100 Squadre & 40 Giornate)" busy="Stress test in corso..." />
      </button>
      {step ? <p className="lab-step">{step}</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {report ? <ReportBox report={report} /> : null}
      <div className="lab-reset-wrap">
        <button className="danger lab-reset" type="button" disabled={pending} aria-busy={step === "Svuoto la sandbox."} onClick={() => void reset()}>
          <BusyLabel pending={step === "Svuoto la sandbox."} idle="Svuota Sandbox" busy="Svuoto..." />
        </button>
      </div>
    </section>
  );
}

function ReportBox({ report }: { report: Report }) {
  const average = report.weeks > 0 ? Math.round(report.elapsedMs / report.weeks) : 0;
  return (
    <div className="lab-report">
      <h3>Report</h3>
      <div className="summary-grid">
        <p className="stat">Tempo totale<strong>{formatDuration(report.elapsedMs)}</strong></p>
        <p className="stat">Giornate<strong>{report.weeks}</strong></p>
        <p className="stat">Checkpoint<strong>{report.checkpoints}</strong></p>
        <p className="stat">Media a giornata<strong>{average.toLocaleString("it-IT")} ms</strong></p>
      </div>
      <div>
        <h3>Podio</h3>
        {report.podium.length === 0 ? <p className="small muted">Classifica non disponibile.</p> : (
          <ol className="lab-podium">
            {report.podium.map((row) => (
              <li key={row.rank}>
                <span>{row.rank}° {row.name}</span>
                <strong>{row.total.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</strong>
              </li>
            ))}
          </ol>
        )}
      </div>
      {report.anomalies.length === 0 ? <p className="small muted">Nessuna anomalia rilevata.</p> : (
        <ul className="audit-lines">
          {report.anomalies.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function formatDuration(ms: number) {
  const precise = `${ms.toLocaleString("it-IT")} ms`;
  if (ms < 1000) return precise;
  const seconds = (ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 });
  return `${seconds} s · ${precise}`;
}
