"use client";

import { useRef, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import type { SandboxReport } from "@/lib/server/sandbox-lab";

const SIZES = [1, 10, 50, 200] as const;

export function SandboxDesk() {
  const [size, setSize] = useState<(typeof SIZES)[number]>(1);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<{ elapsedMs: number; weeks: number; checkpoints: number; anomalies: string[]; teams: number } | null>(null);
  const flight = useRef(false);

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

  async function seed() {
    if (flight.current) return;
    const confirmed = window.confirm("Generare SANDBOX_STRESS_TEST con 100 squadre? Se esiste già, viene ricreata. Le leghe reali restano intatte.");
    if (!confirmed) return;
    flight.current = true;
    setPending("seed");
    setError(null);
    setReport(null);
    try {
      const result = await post({ action: "seed" }) as { teams: number; rostersValid: number };
      setProgress(`${result.teams} squadre create. Rose valide per il validatore: ${result.rostersValid}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Generazione non riuscita.");
    } finally {
      flight.current = false;
      setPending(null);
    }
  }

  async function simulate() {
    if (flight.current) return;
    const confirmed = window.confirm(`Simulare ${size} giornate nella sola lega sandbox, a gruppi di 5, con il motore di calcolo reale?`);
    if (!confirmed) return;
    flight.current = true;
    setPending("simulate");
    setError(null);
    const totals = { elapsedMs: 0, weeks: 0, checkpoints: 0, anomalies: [] as string[], teams: 0 };
    try {
      let cursor = 1;
      while (cursor) {
        setProgress(`Giornate sandbox fino a ${cursor} di ${size}...`);
        const batch = await post({ action: "simulate", cursor, size }) as SandboxReport;
        totals.elapsedMs += batch.elapsedMs;
        totals.weeks += batch.weeks.length;
        totals.checkpoints += batch.checkpoints;
        totals.teams = batch.teams;
        totals.anomalies.push(...batch.anomalies);
        if (batch.nextCursor == null) break;
        cursor = batch.nextCursor;
      }
      setReport({ ...totals, anomalies: totals.anomalies.slice(0, 40) });
      setProgress(null);
    } catch (reason) {
      setReport(totals.weeks > 0 ? totals : null);
      setError(reason instanceof Error ? reason.message : "Simulazione non riuscita.");
    } finally {
      flight.current = false;
      setPending(null);
    }
  }

  async function reset() {
    if (flight.current) return;
    const confirmed = window.confirm("Svuotare solo i dati con is_sandbox = true? Formazioni, voti simulati, squadre e lega sandbox vengono eliminati. Le leghe reali no.");
    if (!confirmed) return;
    flight.current = true;
    setPending("reset");
    setError(null);
    setReport(null);
    try {
      const result = await post({ action: "reset" }) as { teams: number; weeks: number };
      setProgress(`Sandbox svuotata. Squadre rimosse: ${result.teams}. Giornate rimosse: ${result.weeks}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reset non riuscito.");
    } finally {
      flight.current = false;
      setPending(null);
    }
  }

  return (
    <section className="card stack">
      <h2>Laboratorio Stress Test (Sandbox)</h2>
      <p className="small muted">
        La lega SANDBOX_STRESS_TEST e le sue 100 squadre nascono con is_sandbox. Calendario, voti e punteggi stanno su una stagione separata. Il cron del gioco reale non le legge.
      </p>
      {error ? <p className="banner">{error}</p> : null}
      {progress ? <p className="banner ok">{progress}</p> : null}
      <div className="row">
        <button className="primary" type="button" disabled={pending !== null} aria-busy={pending === "seed"} onClick={() => void seed()}>
          <BusyLabel pending={pending === "seed"} idle="Genera Lega Sandbox + 100 Squadre" busy="Genero..." />
        </button>
        <label>
          Giornate
          <select value={size} disabled={pending !== null} onChange={(event) => setSize(Number(event.target.value) as (typeof SIZES)[number])}>
            {SIZES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button className="ghost" type="button" disabled={pending !== null} aria-busy={pending === "simulate"} onClick={() => void simulate()}>
          <BusyLabel pending={pending === "simulate"} idle="Simula giornate" busy="Simulo..." />
        </button>
        <button className="danger" type="button" disabled={pending !== null} aria-busy={pending === "reset"} onClick={() => void reset()}>
          <BusyLabel pending={pending === "reset"} idle="Svuota e Resetta Sandbox" busy="Svuoto..." />
        </button>
      </div>
      {report ? (
        <div className="stack">
          <h3>Report diagnostico</h3>
          <p>Tempo totale: {report.elapsedMs} ms. Giornate elaborate: {report.weeks}. Checkpoint elaborati: {report.checkpoints}. Squadre: {report.teams}.</p>
          {report.anomalies.length === 0 ? <p className="small muted">Nessuna anomalia rilevata.</p> : (
            <ul className="audit-lines">
              {report.anomalies.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
