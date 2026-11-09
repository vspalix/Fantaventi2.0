"use client";

import { useState } from "react";
import type { EngineTestReport, TestCheck, TestStatus } from "@/lib/testing/scoringEngineTestSuite";

const BLOCKS = ["Casi base", "Stress", "Rete", "Performance", "Query"];

function formatMs(value: number) {
  return `${value.toFixed(3)} ms`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Operazione non riuscita.");
  return payload;
}

function StatusPill({ status }: { status: TestStatus }) {
  return <span className="status-pill" data-status={status}>{status}</span>;
}

export function TestEnginePanel() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<EngineTestReport | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/run-engine-tests", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulateNetworkLatency: true }),
      });
      if (response.type === "opaqueredirect" || response.status === 401) {
        throw new Error("La sessione non accompagna questa richiesta. Il laboratorio resta su questa pagina: entra di nuovo e rilancia la suite.");
      }
      setReport(await readJson<EngineTestReport>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Suite non eseguita.");
    } finally {
      setPending(false);
    }
  }

  const groups = BLOCKS.map((block) => ({
    block,
    checks: report?.checks.filter((check) => check.block === block) ?? [],
  })).filter((group) => group.checks.length > 0);

  return (
    <article className="card stack">
      <header className="roster-main-head">
        <div>
          <h2>Test di regressione, stress e performance</h2>
          <p>
            Ogni query mockata aspetta 100 ms. Il PASSED arriva solo se il caricamento della giornata resta nel budget della schermata. Le select vere restano in sola lettura.
          </p>
        </div>
        <button className="primary" type="button" disabled={pending} onClick={() => void run()}>
          {pending ? "Suite in corso, con 100 ms per query…" : "Esegui la suite"}
        </button>
      </header>
      {error ? <p className="banner">{error}</p> : null}
      {report ? (
        <>
          <div className="test-dash">
            <div className="stat" data-ok={report.status === "PASSED"}>
              <span className="small muted">Esito</span>
              <strong><StatusPill status={report.status} /></strong>
            </div>
            <div className="stat" data-ok={report.failed === 0}>
              <span className="small muted">Casi</span>
              <strong>{report.passed} ok · {report.failed} ko</strong>
            </div>
            <div className="stat">
              <span className="small muted">Durata suite</span>
              <strong>{formatMs(report.durationMs)}</strong>
            </div>
            <div className="stat" data-ok={report.load.durationMs <= report.load.budgetMs}>
              <span className="small muted">Carico</span>
              <strong>{report.load.leagues} leghe · {report.load.lineups} rose</strong>
              <span className="small muted">{report.load.lineupsPerSecond.toLocaleString("it-IT")} rose/s · {formatMs(report.load.durationMs)}</span>
            </div>
          </div>
          {groups.map((group) => (
            <section key={group.block} className="stack">
              <h3>{group.block}</h3>
              <div className="sheet-scroll test-scroll">
                <table className="standings">
                  <thead>
                    <tr>
                      <th>Caso</th>
                      <th>Esito</th>
                      <th>Atteso</th>
                      <th>Ottenuto</th>
                      <th>Delta</th>
                      <th>Tempo</th>
                      <th>Budget</th>
                      <th>Collo di bottiglia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.checks.map((check) => (
                      <CheckRow key={check.id} check={check} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      ) : (
        <p className="small muted">Nessuna esecuzione in questa sessione. Il pannello mostra tempi, delta e il punto che sfora il budget.</p>
      )}
    </article>
  );
}

function CheckRow({ check }: { check: TestCheck }) {
  return (
    <tr data-status={check.status}>
      <td><strong>{check.id}</strong> {check.name}</td>
      <td><StatusPill status={check.status} /></td>
      <td>{check.expected}</td>
      <td>{check.actual}</td>
      <td>{check.delta ?? "—"}</td>
      <td>{formatMs(check.durationMs)}</td>
      <td>{check.budgetMs == null ? "—" : formatMs(check.budgetMs)}</td>
      <td>{check.bottleneck ?? "—"}</td>
    </tr>
  );
}
