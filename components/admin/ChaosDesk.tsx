"use client";

import { useState } from "react";

type ChaosStep = { name: string; passed: boolean; detail: string };

type ChaosReport = {
  passed: boolean;
  steps: ChaosStep[];
  sandboxRemoved: boolean;
  error?: string;
};

type ScenarioStepReport = { index: number; action: string; passed: boolean; detail: string };

type ScenarioRun = {
  name: string;
  passed: boolean;
  narrative: string;
  steps: ScenarioStepReport[];
  sandboxRemoved: boolean;
  error?: string;
};

const EXAMPLE = `{
  "name": "Giornata di scenario",
  "steps": [
    { "action": "CREATE_USER", "as": "alice" },
    { "action": "CREATE_USER", "as": "bob" },
    { "action": "ASSIGN_ROSTER", "user": "alice", "players": "auto" },
    { "action": "ASSIGN_ROSTER", "user": "bob", "players": "auto" },
    { "action": "CREATE_LEAGUE", "as": "lega", "owner": "alice", "name": "H2H", "format": "h2h" },
    { "action": "JOIN_LEAGUE", "user": "bob", "league": "lega" },
    { "action": "SUBMIT_LINEUP", "user": "alice", "league": "lega", "week": 1, "repeat": 8 },
    { "action": "SKIP_LINEUP", "user": "bob", "week": 1 },
    { "action": "FILE_FORGOTTEN", "week": 1, "users": "bob" },
    { "action": "LOAD_VOTES", "week": 1, "rows": [{ "club": "JUV", "voto": 7, "goals": 1 }] },
    { "action": "SCORE", "week": 1, "times": 2 },
    { "action": "ASSERT_LINEUP_COUNT", "user": "alice", "week": 1, "lineups": 1 },
    { "action": "ASSERT_RANKING", "league": "lega" }
  ]
}`;

export function ChaosDesk() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ChaosReport | null>(null);
  const [matchId, setMatchId] = useState("");
  const [gameweekId, setGameweekId] = useState("");
  const [notice, setNotice] = useState("");
  const [scenarioFile, setScenarioFile] = useState<File | null>(null);
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [scenario, setScenario] = useState<ScenarioRun | null>(null);

  async function runChaos() {
    setRunning(true);
    setReport(null);
    try {
      const response = await fetch("/api/admin/chaos-test", { method: "POST" });
      const body = (await response.json()) as ChaosReport;
      setReport(body.error ? { passed: false, steps: [], sandboxRemoved: false, error: body.error } : body);
    } catch (error) {
      setReport({
        passed: false,
        steps: [],
        sandboxRemoved: false,
        error: error instanceof Error ? error.message : "Test non eseguito.",
      });
    } finally {
      setRunning(false);
    }
  }

  async function send(action: "postponed" | "recalculate", postponed?: boolean) {
    setNotice("");
    const response = await fetch("/api/admin/match-control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        matchId: matchId.trim(),
        postponed,
        gameweekId: gameweekId.trim(),
      }),
    });
    const body = (await response.json()) as { error?: string; postponed?: boolean; teams?: number; board?: number; gameweekNumber?: number };
    if (!response.ok) {
      setNotice(body.error ?? "Operazione non riuscita.");
      return;
    }
    if (action === "postponed") {
      setNotice(postponed ? "Partita segnata come rinviata. I suoi voti non entrano nel calcolo." : "Rinvio tolto. Lancia il ricalcolo straordinario per applicare i voti del recupero.");
      return;
    }
    setNotice(`Giornata ${body.gameweekNumber ?? ""} ricalcolata su ${body.teams ?? 0} squadre. Bacheca aggiornata (${body.board ?? 0} leghe).`);
  }

  async function runScenario() {
    if (!scenarioFile) return;
    setScenarioRunning(true);
    setScenario(null);
    try {
      const body = new FormData();
      body.set("file", scenarioFile);
      const response = await fetch("/api/admin/scenario", { method: "POST", body });
      const payload = (await response.json()) as ScenarioRun;
      setScenario(payload.error && !payload.narrative
        ? { name: scenarioFile.name, passed: false, narrative: payload.error, steps: [], sandboxRemoved: false, error: payload.error }
        : payload);
    } catch (error) {
      setScenario({
        name: scenarioFile.name,
        passed: false,
        narrative: error instanceof Error ? error.message : "Scenario non eseguito.",
        steps: [],
        sandboxRemoved: false,
      });
    } finally {
      setScenarioRunning(false);
    }
  }

  function downloadExample() {
    const blob = new Blob([EXAMPLE], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scenario-fantaventi.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
    <article className="card stack">
      <header>
        <h2>Chaos Test Lab</h2>
        <p className="lede">
          Quindici rose finte, invii doppi, giornata saltata, mercato e due calcoli della stessa giornata.
          Il test usa le giornate 901 e 902 e le cancella alla fine. Le giornate vere non vengono calcolate.
        </p>
      </header>
      <button className="primary" type="button" disabled={running} onClick={() => void runChaos()}>
        {running ? "Test in corso…" : "Lancia il test caos"}
      </button>
      {report ? (
        <div className="stack">
          <p>{report.error ? report.error : report.passed ? "Test superato." : "Test fallito."}</p>
          {report.sandboxRemoved ? <p>Sandbox rimossa.</p> : null}
          <ul>
            {report.steps.map((step) => (
              <li key={step.name}>
                <strong>{step.passed ? "OK" : "Errore"} · {step.name}.</strong> {step.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <header>
        <h2>Emergenze di campionato</h2>
        <p className="lede">
          Una partita rinviata toglie i voti di quei club solo nel calcolo. In una lega H2H con attesa del recupero
          quella giornata resta fuori classifica finché il rinvio non viene tolto. Il ricalcolo straordinario
          riscrive la giornata già calcolata e rigenera la bacheca, senza toccare le altre giornate.
        </p>
      </header>
      <label>
        Id partita
        <input value={matchId} onChange={(event) => setMatchId(event.target.value)} placeholder="uuid della partita" />
      </label>
      <div className="row">
        <button className="primary" type="button" onClick={() => void send("postponed", true)}>Segna rinviata</button>
        <button type="button" onClick={() => void send("postponed", false)}>Recupero concluso</button>
      </div>
      <label>
        Id giornata
        <input value={gameweekId} onChange={(event) => setGameweekId(event.target.value)} placeholder="uuid della giornata calcolata" />
      </label>
      <button className="primary" type="button" onClick={() => void send("recalculate")}>Ricalcolo straordinario</button>
      {notice ? <p>{notice}</p> : null}
    </article>
    <article className="card stack">
      <header>
        <h2>Scenario runner</h2>
        <p className="lede">
          Carica uno script JSON, CSV o Excel. Ogni riga è un&apos;azione del dizionario: utenti, leghe, rose,
          formazioni, voti, live, calcolo e controlli. La giornata 1 dello script è una giornata di scenario,
          isolata da quelle vere. A fine corsa la sandbox viene tolta e sotto trovi il resoconto di cosa è andato bene e cosa no.
        </p>
      </header>
      <input
        type="file"
        accept=".json,.csv,.xlsx,application/json,text/csv"
        onChange={(event) => setScenarioFile(event.target.files?.[0] ?? null)}
      />
      <div className="row">
        <button className="primary" type="button" disabled={scenarioRunning || !scenarioFile} onClick={() => void runScenario()}>
          {scenarioRunning ? "Scenario in corso…" : "Esegui lo script"}
        </button>
        <button type="button" onClick={downloadExample}>Scarica un esempio</button>
      </div>
      {scenario ? (
        <div className="stack">
          <p>{scenario.passed ? "Scenario superato." : "Scenario con passi falliti."}</p>
          <pre>{scenario.narrative}</pre>
          <ul>
            {scenario.steps.map((step) => (
              <li key={`${step.index}-${step.action}`}>
                <strong>{step.passed ? "OK" : "Errore"} · {step.index}. {step.action}.</strong> {step.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
    </>
  );
}
