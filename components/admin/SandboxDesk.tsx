"use client";

import { useRef, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import type { SandboxPodiumRow, SandboxReport } from "@/lib/server/sandbox-lab";

const FULL_WEEKS = 40;
const SIZES = [1, 10, 40, 50, 200] as const;

type Status = "ready" | "running" | "done" | "error";
type Job = "run" | "seed" | "simulate" | "reset";

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
  const [size, setSize] = useState<(typeof SIZES)[number]>(40);
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<Status>("ready");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const flight = useRef(false);
  const pending = job !== null;

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

  async function simulateWeeks(weeks: number) {
    const totals: Report = { elapsedMs: 0, weeks: 0, checkpoints: 0, anomalies: [], teams: 0, podium: [] };
    let cursor = 1;
    while (cursor) {
      setStep(`Calcolo la giornata ${Math.min(cursor, weeks)} di ${weeks}.`);
      const batch = await post({ action: "simulate", cursor, size: weeks }) as SandboxReport;
      totals.elapsedMs += batch.elapsedMs;
      totals.weeks += batch.weeks.length;
      totals.checkpoints += batch.checkpoints;
      totals.teams = batch.teams;
      totals.anomalies.push(...batch.anomalies);
      totals.podium = batch.podium;
      setReport({ ...totals, anomalies: totals.anomalies.slice(0, 40) });
      if (batch.nextCursor == null) break;
      cursor = batch.nextCursor;
    }
    return { ...totals, anomalies: totals.anomalies.slice(0, 40) };
  }

  async function run() {
    if (flight.current) return;
    const confirmed = window.confirm("Avviare lo stress test completo? Cancella la sandbox precedente, crea 100 squadre e simula 40 giornate. Le leghe reali non vengono toccate.");
    if (!confirmed) return;
    flight.current = true;
    setJob("run");
    setStatus("running");
    setError(null);
    setReport(null);
    try {
      setStep("Preparo la lega e le 100 squadre.");
      await post({ action: "seed" });
      setReport(await simulateWeeks(FULL_WEEKS));
      setStep(null);
      setStatus("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stress test non riuscito.");
      setStep(null);
      setStatus("error");
    } finally {
      flight.current = false;
      setJob(null);
    }
  }

  async function seed() {
    if (flight.current) return;
    const confirmed = window.confirm("Generare SANDBOX_STRESS_TEST con 100 squadre? Se esiste già, viene ricreata. Le leghe reali restano intatte.");
    if (!confirmed) return;
    flight.current = true;
    setJob("seed");
    setStatus("running");
    setError(null);
    setReport(null);
    try {
      const result = await post({ action: "seed" }) as { teams: number; rostersValid: number };
      setStep(`${result.teams} squadre create. Rose valide: ${result.rostersValid}.`);
      setStatus("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Generazione non riuscita.");
      setStep(null);
      setStatus("error");
    } finally {
      flight.current = false;
      setJob(null);
    }
  }

  async function simulate() {
    if (flight.current) return;
    const confirmed = window.confirm(`Simulare ${size} giornate nella sola lega sandbox, a gruppi di 5, con il motore di calcolo reale?`);
    if (!confirmed) return;
    flight.current = true;
    setJob("simulate");
    setStatus("running");
    setError(null);
    setReport(null);
    try {
      setReport(await simulateWeeks(size));
      setStep(null);
      setStatus("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Simulazione non riuscita.");
      setStep(null);
      setStatus("error");
    } finally {
      flight.current = false;
      setJob(null);
    }
  }

  async function reset() {
    if (flight.current) return;
    const confirmed = window.confirm("Svuotare solo i dati con is_sandbox = true? Formazioni, voti simulati, squadre e lega sandbox vengono eliminati. Le leghe reali no.");
    if (!confirmed) return;
    flight.current = true;
    setJob("reset");
    setStatus("running");
    setStep("Svuoto la sandbox.");
    setError(null);
    setReport(null);
    try {
      const result = await post({ action: "reset" }) as { teams: number; weeks: number };
      setStep(`Sandbox svuotata. Squadre rimosse: ${result.teams}. Giornate rimosse: ${result.weeks}.`);
      setStatus("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reset non riuscito.");
      setStep(null);
      setStatus("error");
    } finally {
      flight.current = false;
      setJob(null);
    }
  }

  return (
    <section className="card lab-panel">
      <header className="lab-head">
        <h2>Laboratorio Stress Test (Sandbox)</h2>
        <span className="status-pill lab-status" data-status={status}>Stato: {STATUS_LABEL[status]}</span>
      </header>
      <p className="lede">
        La lega SANDBOX_STRESS_TEST resta isolata. Puoi lanciare il percorso completo oppure preparare le squadre e scegliere quante giornate simulare.
      </p>
      <button className="primary lab-go" type="button" disabled={pending} aria-busy={job === "run"} onClick={() => void run()}>
        <BusyLabel pending={job === "run"} idle="🚀 Avvia Stress Test Completo (100 Squadre & 40 Giornate)" busy="Stress test in corso..." />
      </button>
      <div className="lab-manual">
        <h3>Passi separati</h3>
        <div className="row">
          <button className="ghost" type="button" disabled={pending} aria-busy={job === "seed"} onClick={() => void seed()}>
            <BusyLabel pending={job === "seed"} idle="Genera Lega Sandbox + 100 Squadre" busy="Genero..." />
          </button>
          <label>
            Giornate
            <select aria-label="Giornate" value={size} disabled={pending} onChange={(event) => setSize(Number(event.target.value) as (typeof SIZES)[number])}>
              {SIZES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button className="ghost" type="button" disabled={pending} aria-busy={job === "simulate"} onClick={() => void simulate()}>
            <BusyLabel pending={job === "simulate"} idle="Simula giornate" busy="Simulo..." />
          </button>
        </div>
      </div>
      {step ? <p className="lab-step">{step}</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {report ? <ReportBox report={report} /> : null}
      <div className="lab-reset-wrap">
        <button className="danger lab-reset" type="button" disabled={pending} aria-busy={job === "reset"} onClick={() => void reset()}>
          <BusyLabel pending={job === "reset"} idle="Svuota e Resetta Sandbox" busy="Svuoto..." />
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
