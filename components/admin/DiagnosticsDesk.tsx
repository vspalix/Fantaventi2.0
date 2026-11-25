"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DiagnosticJob, OpsDiagnostics } from "@/lib/server/ops-diagnostics";
import type { SyncLogRow } from "@/lib/server/system-settings";

const JOB = { votes: "Voti", availability: "Indisponibili", kickoffs: "Orari" };
const ORIGIN = { cron: "Cron", manual: "Manuale" };
const STATUS = { success: "Ok", skipped: "Saltato", error: "Errore", missing: "Mai eseguito" };

function when(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" }).format(date);
}

export function DiagnosticsDesk({ data }: { data: OpsDiagnostics }) {
  const router = useRouter();
  const [job, setJob] = useState<"all" | SyncLogRow["jobType"]>("all");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const logs = useMemo(() => data.logs.filter((row) => {
    if (job !== "all" && row.jobType !== job) return false;
    if (onlyErrors && row.status !== "error") return false;
    return true;
  }), [data.logs, job, onlyErrors]);

  return (
    <div className="stack">
      {data.anomalies.length === 0 ? <p className="banner ok">Nessuna anomalia evidente sui dati letti adesso.</p> : data.anomalies.map((item) => (
        <p className="banner" key={item}>{item}</p>
      ))}

      <section className="card stack">
        <h2>Giornata corrente</h2>
        <p><strong>{data.matchday.label}</strong></p>
        <p>Fase: {data.matchday.phase}</p>
        <p>Cutoff formazione: {when(data.matchday.deadlineAt)}</p>
        <p>Primo fischio: {when(data.matchday.firstKickoffAt)}</p>
        <p className="small muted">{data.matchday.matchesLabel}</p>
        <p className="small muted">Telegram {data.telegramConfigured ? "configurato" : "non configurato"}. Modalità test riepiloghi: {data.notifyOnSyncSuccess ? "accesa" : "spenta"}.</p>
      </section>

      <section className="diag-grid">
        {data.jobs.map((item) => <JobCard key={item.jobType} job={item} />)}
      </section>

      <section className="card stack">
        <div className="row">
          <h2>Log recenti</h2>
          <button className="ghost" type="button" onClick={() => router.refresh()}>Aggiorna</button>
        </div>
        <div className="row">
          {(["all", "votes", "availability", "kickoffs"] as const).map((value) => (
            <button key={value} className={job === value ? "primary" : "ghost"} type="button" onClick={() => setJob(value)}>
              {value === "all" ? "Tutti" : JOB[value]}
            </button>
          ))}
          <button className={onlyErrors ? "danger" : "ghost"} type="button" onClick={() => setOnlyErrors((current) => !current)}>Solo errori</button>
        </div>
        {logs.length === 0 ? <p className="small muted">Nessun log con questo filtro. Togli il filtro o aspetta il prossimo giro.</p> : null}
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

function JobCard({ job }: { job: DiagnosticJob }) {
  return (
    <article className="card stack">
      <h2>{job.label}</h2>
      <p><span className="sync-badge" data-status={job.status === "missing" ? "skipped" : job.status}>{STATUS[job.status]}</span></p>
      <p className="small">Ultimo giro: {when(job.at)}</p>
      <p className="small">Origine: {job.origin ? ORIGIN[job.origin] : "—"}</p>
      <p className="small">Record scritti: {job.recordsWritten}</p>
      <p className="small muted">{job.message}</p>
    </article>
  );
}
