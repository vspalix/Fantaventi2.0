"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  GAMEWEEK_STATUSES,
  TEST_TEAM_PASSWORD,
  type GameweekStatus,
  type GeneratedTestTeam,
  type LateJoinReport,
  type AdminFiledLineup,
  type TestLabSnapshot,
} from "@/lib/admin-types";
import { LoadedVotes } from "@/components/admin/LoadedVotes";
import { ScoreAuditDialog } from "@/components/admin/ScoreAuditDialog";
import { SystemHealthPanel } from "@/components/admin/SystemHealthPanel";
import { TestEnginePanel } from "@/components/admin/TestEnginePanel";
import { ROLE_LABEL } from "@/lib/types";

const STATUS_HINT: Record<GameweekStatus, string> = {
  scheduled: "in programma",
  open: "aperta",
  locked: "bloccata",
  scored: "calcolata",
  final: "chiusa",
};

type SimScore = {
  fantasyTeamId: string;
  teamName: string;
  total: number;
  playersPoints: number;
  captainModifier: number;
  fairPlay: number;
  defenseModifier: number;
  reservePoints: number;
};

type SimResult = {
  gameweekNumber: number;
  status: string;
  ratedPlayers: number;
  listone: number;
  teamsScored: number;
  nextGameweekNumber: number | null;
  scores: SimScore[];
};

type VoteLoad = {
  gameweekNumber: number;
  rated: number;
  listone: number;
};

type LabTab = "home" | "formazioni" | "squadre" | "giornate" | "calendario" | "test" | "stato";

type CalendarMatch = {
  id: string;
  home: string;
  away: string;
  kickoffAt: string;
  status: string;
  kickoffLocked?: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
};

type KickoffRefresh = {
  skipped: boolean;
  reason: string | null;
  updated: number;
  kept: number;
  results?: number;
  goalsColumn?: boolean;
  deadlines: number;
  rounds: number;
  lockColumn: boolean;
};

type CalcResult = {
  gameweekNumber: number;
  teams: number;
  status: string;
};

type StartSave = {
  gameweekNumber: number;
  protectedFromRefresh: boolean;
};

type CalendarImport = {
  rounds: number;
  fixtures: number;
  deadlines: number;
  kickoffsWithPublishedTime: number;
};

type ResetResult = {
  gameweekNumber: number;
  scoresCleared: number;
  votesCleared: number;
  status: string;
};

type MatchdayRun = {
  skipped?: boolean;
  voteDelayMinutes: number;
  votes: {
    synced: { gameweekNumber: number; players: number }[];
    waiting: { gameweekNumber: number; reason: string }[];
    projected?: number[];
    scored: number[];
    skipped?: { gameweekNumber: number; reason: string }[];
    errors: { message: string }[];
  };
  lifecycle: {
    locked: number[];
    finalized: number[];
  };
};

function matchdaySummary(run: MatchdayRun) {
  const downloaded = run.votes.synced.length;
  const players = run.votes.synced.reduce((sum, match) => sum + match.players, 0);
  const scored = [...new Set(run.votes.scored)];
  const lines = [
    `Controllo con la regola dei ${run.voteDelayMinutes} minuti dal calcio d'inizio.`,
  ];
  if (downloaded > 0) {
    lines.push(`Recuperati i voti di ${downloaded} partite, ${players} calciatori.`);
  } else {
    lines.push("Nessuna partita nuova da scaricare: o non sono passati 130 minuti, o i voti sono già salvati.");
  }
  if (scored.length > 0) lines.push(`Calcolate le giornate ${scored.join(", ")}. Apri Audit calcolo per bonus, malus e sostituzioni.`);
  else if (run.skipped) lines.push("Nessun punteggio ufficiale ricalcolato: le giornate già calcolate restano ferme.");
  if ((run.votes.projected ?? []).length > 0) {
    lines.push(`Proiezione live aggiornata per le giornate ${run.votes.projected?.join(", ")}.`);
  }
  if (run.lifecycle.locked.length > 0) lines.push(`Formazioni bloccate nelle giornate ${run.lifecycle.locked.join(", ")}.`);
  if (run.lifecycle.finalized.length > 0) lines.push(`Giornate diventate definitive: ${run.lifecycle.finalized.join(", ")}.`);
  if (run.votes.errors.length > 0) lines.push(run.votes.errors.map((item) => item.message).join(" "));
  return lines.join(" ");
}

const MATCH_LABEL: Record<string, string> = {
  scheduled: "in programma",
  locked: "fischio d'inizio",
  live: "in corso",
  finished: "finita",
};

function kickoffLabel(value: string) {
  return new Date(value).toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function romeInput(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${bag.year}-${bag.month}-${bag.day}T${bag.hour}:${bag.minute}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Operazione non riuscita.");
  return payload;
}

function formatSavedAt(iso: string) {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome",
  }).format(date);
  const time = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  }).format(date);
  return `${day} alle ${time}`;
}

function isStillOpen(week: TestLabSnapshot["gameweeks"][number], now = Date.now()) {
  const closed = week.status === "locked" || week.status === "scored" || week.status === "final";
  return !closed && new Date(week.deadlineAt).getTime() > now;
}

function openingGameweek(gameweeks: TestLabSnapshot["gameweeks"]) {
  return gameweeks.find((week) => isStillOpen(week))
    ?? gameweeks[gameweeks.length - 1]
    ?? null;
}

function points(value: number) {
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function signed(value: number) {
  const text = points(value);
  return value > 0 ? `+${text}` : text;
}

function ScoreTable({ scores, onAudit }: { scores: SimScore[]; onAudit: (fantasyTeamId: string) => void }) {
  const rows = [...scores].sort((left, right) => right.total - left.total || left.teamName.localeCompare(right.teamName, "it"));
  if (rows.length === 0) return <p className="small muted">Nessuna squadra aveva una formazione da calcolare.</p>;
  return (
    <table className="standings">
      <thead>
        <tr>
          <th>Squadra</th>
          <th>Totale</th>
          <th>Giocatori</th>
          <th>Capitano</th>
          <th>Fair play</th>
          <th>Difesa</th>
          <th>Panchina</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.fantasyTeamId}>
            <td><strong>{row.teamName}</strong></td>
            <td>{points(row.total)}</td>
            <td>{points(row.playersPoints)}</td>
            <td>{signed(row.captainModifier)}</td>
            <td>{signed(row.fairPlay)}</td>
            <td>{signed(row.defenseModifier)}</td>
            <td>{signed(row.reservePoints)}</td>
            <td><button className="text-button" type="button" onClick={() => onAudit(row.fantasyTeamId)}>Audit</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function orderedLineups(lineups: AdminFiledLineup[]) {
  return [...lineups].sort((left, right) => Number(right.isMine) - Number(left.isMine) || left.teamName.localeCompare(right.teamName, "it"));
}

function LineupStatusTable({
  lineups,
  busy,
  canEdit,
  onFile,
}: {
  lineups: AdminFiledLineup[];
  busy: boolean;
  canEdit: boolean;
  onFile: (fantasyTeamId: string, filed: boolean) => void;
}) {
  const rows = orderedLineups(lineups);
  if (rows.length === 0) return <p className="small muted">Nessuna squadra in questa lega.</p>;
  return (
    <table className="standings">
      <thead>
        <tr>
          <th>Squadra</th>
          <th>Stato</th>
          <th>Orario</th>
          <th>Comandi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((lineup) => (
          <tr key={lineup.fantasyTeamId} data-mine={lineup.isMine}>
            <td>
              <strong>{lineup.teamName}</strong>
              <span className="small muted"> · {lineup.displayName}{lineup.isMine ? " · la tua" : ""}</span>
            </td>
            <td>{lineup.filed ? "Schierata" : "Non schierata"}</td>
            <td>{lineup.filed ? (lineup.savedAt ? formatSavedAt(lineup.savedAt) : "Orario non registrato") : "—"}</td>
            <td>
              <div className="row">
                <button className="ghost" type="button" disabled={busy || !canEdit} onClick={() => onFile(lineup.fantasyTeamId, true)}>
                  Schiera
                </button>
                <button className="ghost" type="button" disabled={busy || !canEdit || !lineup.filed} onClick={() => onFile(lineup.fantasyTeamId, false)}>
                  Togli
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LineupDetailList({ lineups }: { lineups: AdminFiledLineup[] }) {
  const rows = orderedLineups(lineups);
  if (rows.length === 0) return <p className="small muted">Nessuna squadra in questa lega.</p>;
  return (
    <div className="stack">
      {rows.map((lineup) => (
        <section key={lineup.fantasyTeamId}>
          <h3>{lineup.teamName}{lineup.isMine ? " · la tua" : ""}</h3>
          <p className="small muted">
            {lineup.displayName}
            {" · "}
            {lineup.filed
              ? lineup.savedAt
                ? `Schierata · ${formatSavedAt(lineup.savedAt)}`
                : "Schierata · orario non registrato"
              : "Non schierata"}
          </p>
          {lineup.filed ? (
            <div className="side-list">
              {lineup.starters.map((player, index) => (
                <p key={`${lineup.fantasyTeamId}-xi-${index}`} className="side-row">
                  <span>
                    {player.fullName}
                    {player.isCaptain ? " · capitano" : ""}
                    {player.isVice ? " · vice" : ""}
                  </span>
                  <span className="small">{ROLE_LABEL[player.role]} · {player.clubShort}</span>
                </p>
              ))}
              {lineup.bench.length === 0 ? <p className="small muted">Panchina vuota.</p> : lineup.bench.map((player, index) => (
                <p key={`${lineup.fantasyTeamId}-bench-${index}`} className="side-row">
                  <span>Panchina {index + 1}. {player.fullName}</span>
                  <span className="small">{ROLE_LABEL[player.role]} · {player.clubShort}</span>
                </p>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export function TestLab({ initial }: { initial: TestLabSnapshot }) {
  const opening = openingGameweek(initial.gameweeks);
  const [snapshot, setSnapshot] = useState(initial);
  const [leagueId, setLeagueId] = useState(initial.leagues[0]?.id ?? "");
  const [gameweekId, setGameweekId] = useState(opening?.id ?? "");
  const [statusDraft, setStatusDraft] = useState<GameweekStatus>(opening?.status ?? "scheduled");
  const [entry, setEntry] = useState(4);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<GeneratedTestTeam[] | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [late, setLate] = useState<LateJoinReport | null>(null);
  const [matches, setMatches] = useState<CalendarMatch[]>([]);
  const [calendar, setCalendar] = useState<CalendarImport | null>(null);
  const [reset, setReset] = useState<ResetResult | null>(null);
  const [calculated, setCalculated] = useState<CalcResult | null>(null);
  const [refresh, setRefresh] = useState<KickoffRefresh | null>(null);
  const [startDraft, setStartDraft] = useState("");
  const [startSave, setStartSave] = useState<StartSave | null>(null);
  const [kickoffDrafts, setKickoffDrafts] = useState<Record<string, string>>({});
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, { home: string; away: string }>>({});
  const [editingKickoff, setEditingKickoff] = useState<string | null>(null);
  const [boardStamp, setBoardStamp] = useState(0);
  const [votesStamp, setVotesStamp] = useState(0);
  const [filedLineups, setFiledLineups] = useState<AdminFiledLineup[]>([]);
  const [lineupStamp, setLineupStamp] = useState(0);
  const [lineupBoard, setLineupBoard] = useState<"lista" | "dettaglio">("lista");
  const [labTab, setLabTab] = useState<LabTab>("home");
  const [testVotes, setTestVotes] = useState<VoteLoad | null>(null);
  const [matchdayRun, setMatchdayRun] = useState<MatchdayRun | null>(null);
  const [scoreboard, setScoreboard] = useState<{ gameweekId: string; scores: SimScore[] } | null>(null);
  const [auditTeamId, setAuditTeamId] = useState<string | null>(null);

  const league = snapshot.leagues.find((item) => item.id === leagueId) ?? null;
  const gameweek = snapshot.gameweeks.find((item) => item.id === gameweekId) ?? null;
  const auditTeams = useMemo(() => {
    const map = new Map<string, string>();
    for (const lineup of filedLineups) map.set(lineup.fantasyTeamId, lineup.teamName);
    if (scoreboard?.gameweekId === gameweekId) {
      for (const score of scoreboard.scores) map.set(score.fantasyTeamId, score.teamName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "it"));
  }, [filedLineups, scoreboard, gameweekId]);
  const currentWeek = openingGameweek(snapshot.gameweeks);
  const busy = pending !== null;

  const entryBounds = useMemo(() => {
    if (!league) {
      const max = snapshot.gameweeks.reduce((top, week) => Math.max(top, week.number), 1);
      return { min: 2, max };
    }
    return { min: league.startMatchday + 1, max: league.endMatchday };
  }, [league]);

  async function reload() {
    const response = await fetch("/api/admin/test-lab");
    const payload = await readJson<{ lab: TestLabSnapshot }>(response);
    setSnapshot(payload.lab);
    return payload.lab;
  }

  async function run(label: string, task: () => Promise<void>) {
    setPending(label);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operazione non riuscita.");
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    if (!gameweekId) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/admin/matches?gameweekId=${encodeURIComponent(gameweekId)}`)
      .then(async (response) => readJson<{ matches: CalendarMatch[] }>(response))
      .then((payload) => {
        if (cancelled) return;
        const body = payload as { matches: CalendarMatch[]; deadlineAt?: string };
        setMatches(body.matches);
        setKickoffDrafts(Object.fromEntries(body.matches.map((match) => [match.id, romeInput(match.kickoffAt)])));
        setScoreDrafts(Object.fromEntries(body.matches.map((match) => [match.id, {
          home: match.homeGoals == null ? "" : String(match.homeGoals),
          away: match.awayGoals == null ? "" : String(match.awayGoals),
        }])));
        if (body.deadlineAt) setStartDraft(romeInput(body.deadlineAt));
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [gameweekId, snapshot, boardStamp]);

  useEffect(() => {
    if (!leagueId || !gameweekId) {
      setFiledLineups([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/admin/lineups?leagueId=${encodeURIComponent(leagueId)}&gameweekId=${encodeURIComponent(gameweekId)}`)
      .then(async (response) => readJson<{ lineups: AdminFiledLineup[] }>(response))
      .then((payload) => {
        if (!cancelled) setFiledLineups(payload.lineups);
      })
      .catch(() => {
        if (!cancelled) setFiledLineups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, gameweekId, snapshot, lineupStamp]);

  useEffect(() => {
    if (!leagueId || !gameweekId) {
      setScoreboard(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/admin/gameweek-scores?leagueId=${encodeURIComponent(leagueId)}&gameweekId=${encodeURIComponent(gameweekId)}`)
      .then(async (response) => readJson<{ scores: SimScore[] }>(response))
      .then((payload) => {
        if (!cancelled) setScoreboard({ gameweekId, scores: payload.scores });
      })
      .catch(() => {
        if (!cancelled) setScoreboard({ gameweekId, scores: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, gameweekId, snapshot]);

  function chooseGameweek(id: string, source: TestLabSnapshot = snapshot) {
    setGameweekId(id);
    const next = source.gameweeks.find((item) => item.id === id);
    if (next) setStatusDraft(next.status);
  }

  async function setFiled(filed: boolean, fantasyTeamId?: string) {
    await run(filed ? "Schiero…" : "Tolgo la formazione…", async () => {
      const response = await fetch("/api/admin/lineups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, gameweekId, filed, fantasyTeamId }),
      });
      await readJson(response);
      setLineupStamp((current) => current + 1);
    });
  }

  return (
    <div className="admin-grid">
      {snapshot.leagues.length === 0 ? (
        <article className="card">
          <h2>Serve una lega</h2>
          <p>Il laboratorio agisce sulle leghe che hai creato. Aprine una, poi torna qui.</p>
          <Link className="primary" href="/leghe">Vai alle leghe</Link>
        </article>
      ) : (
        <article className="card stack">
          <h2>Lega di collaudo</h2>
          <label>
            Lega
            <select
              value={leagueId}
              onChange={(event) => {
                const nextId = event.target.value;
                setLeagueId(nextId);
                const next = snapshot.leagues.find((item) => item.id === nextId);
                if (!next) return;
                setEntry((current) => Math.min(Math.max(current, next.startMatchday + 1), next.endMatchday));
              }}
            >
              {snapshot.leagues.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · giornate {item.startMatchday}–{item.endMatchday}
                </option>
              ))}
            </select>
          </label>
        </article>
      )}

      <div className="tabs" role="tablist" aria-label="Sezioni del laboratorio">
        <button className="tab" type="button" data-active={labTab === "home"} onClick={() => setLabTab("home")}>Home</button>
        <button className="tab" type="button" data-active={labTab === "formazioni"} onClick={() => setLabTab("formazioni")}>Formazioni schierate</button>
        <button className="tab" type="button" data-active={labTab === "squadre"} onClick={() => setLabTab("squadre")}>Squadre di test</button>
        <button className="tab" type="button" data-active={labTab === "giornate"} onClick={() => setLabTab("giornate")}>Giornate e voti</button>
        <button className="tab" type="button" data-active={labTab === "calendario"} onClick={() => setLabTab("calendario")}>Calendario</button>
        <button className="tab" type="button" data-active={labTab === "test"} onClick={() => setLabTab("test")}>Test motore</button>
        <button className="tab" type="button" data-active={labTab === "stato"} onClick={() => setLabTab("stato")}>Stato sistema</button>
      </div>

      {labTab === "test" ? <TestEnginePanel /> : null}
      {labTab === "stato" ? <SystemHealthPanel /> : null}

      {labTab === "home" ? (
        <>
          <article className="card stack">
            <h2>Formazioni schierate</h2>
            <p>
              Giornata {gameweek?.number ?? "—"}: {filedLineups.filter((lineup) => lineup.filed).length} schierate su {filedLineups.length}.
              Da qui controlli chi ha salvato e schieri le squadre di test.
            </p>
            <button className="primary" type="button" onClick={() => setLabTab("formazioni")}>Apri le formazioni</button>
          </article>
          <article className="card stack">
            <h2>Squadre di test</h2>
            <p>
              Ogni clic aggiunge cinque squadre. Schierandole, modulo e titolari cambiano da squadra a squadra e da giornata a giornata.
            </p>
            <button className="primary" type="button" onClick={() => setLabTab("squadre")}>Apri le squadre di test</button>
          </article>
          <article className="card stack">
            <h2>Giornate e voti</h2>
            <p>
              Giornata {gameweek?.number ?? "—"}
              {gameweek ? ` · ${gameweek.status}` : ""}.
              Qui chiudi e calcoli, carichi voti di test sempre diversi, oppure usi i voti ufficiali.
            </p>
            <button className="primary" type="button" onClick={() => setLabTab("giornate")}>Apri giornate e voti</button>
          </article>
          <article className="card stack">
            <h2>Calendario {snapshot.seasonCode}</h2>
            <p>
              Partite, orari e risultati della competizione attiva. L&apos;import del file 2026/27 e la lettura Sky valgono per la Serie A.
            </p>
            <button className="primary" type="button" onClick={() => setLabTab("calendario")}>Apri il calendario</button>
          </article>
        </>
      ) : null}

      {labTab === "formazioni" ? (
      <article className="card stack">
        <h2>Formazioni schierate</h2>
        <div className="gw-row" role="tablist" aria-label="Giornate della lista formazioni">
          {snapshot.gameweeks.map((item) => (
            <button
              key={item.id}
              className="gw-chip"
              type="button"
              data-active={item.id === gameweekId}
              data-next={item.id === currentWeek?.id}
              data-locked={!isStillOpen(item)}
              disabled={busy}
              onClick={() => chooseGameweek(item.id)}
            >
              {item.number}
            </button>
          ))}
        </div>
        {currentWeek && gameweekId !== currentWeek.id ? (
          <button className="ghost" type="button" disabled={busy} onClick={() => chooseGameweek(currentWeek.id)}>
            Torna alla giornata {currentWeek.number}
          </button>
        ) : null}
        <p className="small muted">
          Giornata {gameweek?.number ?? "—"}.
          {gameweek && isStillOpen(gameweek)
            ? " È la giornata attuale, quella ancora modificabile."
            : " Stai consultando una giornata precedente."}
          {" "}L&apos;orario è lo stesso che leggi in home.
        </p>
        <div className="tabs" role="tablist" aria-label="Vista formazioni">
          <button className="tab" type="button" data-active={lineupBoard === "lista"} onClick={() => setLineupBoard("lista")}>
            Lista
          </button>
          <button className="tab" type="button" data-active={lineupBoard === "dettaglio"} onClick={() => setLineupBoard("dettaglio")}>
            Dettaglio
          </button>
        </div>
        {lineupBoard === "lista" ? (
          <>
            <p className="small muted">Schiera e Togli sono comandi di test: da utente la formazione si salva solo dal tab Formazione.</p>
            <div className="row">
              <button className="ghost" type="button" disabled={busy || !leagueId || !gameweekId} onClick={() => void setFiled(true)}>
                Schiera tutte
              </button>
              <button className="ghost" type="button" disabled={busy || !leagueId || !gameweekId} onClick={() => void setFiled(false)}>
                Togli tutte
              </button>
            </div>
            <LineupStatusTable
              lineups={filedLineups}
              busy={busy}
              canEdit={Boolean(leagueId && gameweekId)}
              onFile={(fantasyTeamId, filed) => void setFiled(filed, fantasyTeamId)}
            />
          </>
        ) : (
          <LineupDetailList lineups={filedLineups} />
        )}
      </article>
      ) : null}

      {labTab === "squadre" ? (
      <article className="card stack">
        <h2>Squadre di test</h2>
        <p>
          Ogni clic aggiunge cinque squadre nuove, con email <span className="code-inline">tester-N@fantaventi.test</span> e password
          {" "}<span className="code-inline">{TEST_TEAM_PASSWORD}</span>.
          La numerazione prosegue dopo le squadre già create. Ogni rosa ha un calciatore per club e 3 portieri.
          La formazione non viene scritta da sola: la schieri in Formazioni schierate.
          A ogni schieramento il modulo e i titolari dipendono dalla squadra e dalla giornata, quindi non restano uguali per tutti.
        </p>
        <div className="row">
          <button
            className="primary"
            type="button"
            disabled={busy || !leagueId}
            onClick={() => run("Creo le squadre…", async () => {
              const response = await fetch("/api/admin/test-teams", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leagueId }),
              });
              const payload = await readJson<{ teams: GeneratedTestTeam[] }>(response);
              setTeams(payload.teams);
              await reload();
            })}
          >
            Crea altre squadre di test
          </button>
          {pending === "Creo le squadre…" ? <span className="muted">Creo le squadre…</span> : null}
        </div>
        {teams ? (
          <ul className="list">
            {teams.map((team) => (
              <li key={team.fantasyTeamId} className="person">
                <span>
                  <strong>{team.teamName}</strong>
                  <span className="muted small"> {team.email}</span>
                </span>
                <span className="small">
                  {team.players} · P {team.goalkeepers} D {team.defenders} C {team.midfielders} A {team.forwards}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </article>
      ) : null}

      {labTab === "giornate" ? (
      <article className="card stack">
        <h2>Giornate e voti</h2>
        {snapshot.gameweeks.length === 0 ? (
          <p>Nessuna giornata in stagione. Esegui il calendario SQL e ricarica la pagina.</p>
        ) : (
          <>
            <div className="row admin-controls">
              <label>
                Giornata
                <select value={gameweekId} onChange={(event) => chooseGameweek(event.target.value)}>
                  {snapshot.gameweeks.map((item) => (
                    <option key={item.id} value={item.id}>
                      Giornata {item.number} · {item.status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nuovo stato
                <select
                  value={statusDraft}
                  onChange={(event) => setStatusDraft(event.target.value as GameweekStatus)}
                >
                  {GAMEWEEK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status} · {STATUS_HINT[status]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {gameweek ? (
              <p>
                Stato attuale della giornata {gameweek.number}:{" "}
                <strong className="status-pill">{gameweek.status}</strong>
                <span className="muted"> {STATUS_HINT[gameweek.status]}</span>
              </p>
            ) : null}
            {auditTeams.length > 0 ? (
              <button className="ghost" type="button" onClick={() => setAuditTeamId(auditTeams[0].id)}>
                Audit calcolo
              </button>
            ) : null}
            {scoreboard?.gameweekId === gameweekId && scoreboard.scores.length > 0 ? (
              <div className="stack">
                <h3>Risultati della giornata {gameweek?.number}</h3>
                <ScoreTable scores={scoreboard.scores} onAudit={setAuditTeamId} />
                <p className="muted small">
                  Capitano è il bonus o il malus del capitano effettivo. Fair play è il bonus se la formazione non lo perde.
                  Difesa è il modificatore. Il totale somma giocatori, capitano, fair play, difesa e panchina.
                </p>
              </div>
            ) : gameweek && (gameweek.status === "scored" || gameweek.status === "final") && scoreboard?.gameweekId === gameweekId ? (
              <p className="small muted">Questa giornata è calcolata e non ha totali salvati per le squadre.</p>
            ) : null}
            <LoadedVotes gameweekId={gameweekId} reloadToken={votesStamp} />
            <div className="row">
              <button
                className="primary"
                type="button"
                disabled={busy || !gameweekId}
                onClick={() => run("Apro la giornata…", async () => {
                  const response = await fetch("/api/admin/activate-gameweek", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ gameweekId }),
                  });
                  await readJson(response);
                  const lab = await reload();
                  chooseGameweek(gameweekId, lab);
                })}
              >
                Imposta giornata attiva
              </button>
              <button
                className="ghost"
                type="button"
                disabled={busy || !gameweekId}
                onClick={() => run("Aggiorno lo stato…", async () => {
                  const response = await fetch("/api/admin/gameweek-status", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ gameweekId, status: statusDraft }),
                  });
                  await readJson(response);
                  const lab = await reload();
                  chooseGameweek(gameweekId, lab);
                })}
              >
                Aggiorna stato
              </button>
              <button
                className="ghost"
                type="button"
                disabled={busy || !leagueId || !gameweekId}
                onClick={() => run("Carico i voti di test…", async () => {
                  const response = await fetch("/api/admin/test-votes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ leagueId, gameweekId }),
                  });
                  const payload = await readJson<VoteLoad>(response);
                  setTestVotes(payload);
                  setSim(null);
                  setCalculated(null);
                  setVotesStamp((stamp) => stamp + 1);
                })}
              >
                Carica voti di test
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy || !leagueId || !gameweekId}
                onClick={() => run("Simulo la giornata…", async () => {
                  const response = await fetch("/api/admin/simulate-gameweek", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ leagueId, gameweekId, status: "scored" }),
                  });
                  const payload = await readJson<SimResult>(response);
                  setSim(payload);
                  setVotesStamp((stamp) => stamp + 1);
                  const lab = await reload();
                  chooseGameweek(gameweekId, lab);
                })}
              >
                Chiudi giornata e calcola
              </button>
              <button
                className="ghost"
                type="button"
                disabled={busy || !leagueId || !gameweekId}
                onClick={() => run("Annulla il calcolo…", async () => {
                  const response = await fetch("/api/admin/reset-gameweek", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ leagueId, gameweekId }),
                  });
                  const payload = await readJson<ResetResult>(response);
                  setReset(payload);
                  setSim(null);
                  setCalculated(null);
                  setVotesStamp((stamp) => stamp + 1);
                  const lab = await reload();
                  chooseGameweek(gameweekId, lab);
                })}
              >
                Annulla calcolo
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy || !leagueId}
                onClick={() => run("Recupero i voti…", async () => {
                  const response = await fetch("/api/admin/process-matchday", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ leagueId }),
                  });
                  const payload = await readJson<MatchdayRun>(response);
                  setMatchdayRun(payload);
                  setVotesStamp((stamp) => stamp + 1);
                  const lab = await reload();
                  chooseGameweek(gameweekId, lab);
                })}
              >
                Recupera voti e calcola
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy || !leagueId || !gameweekId}
                onClick={() => run("Calcolo i voti caricati…", async () => {
                  const response = await fetch("/api/admin/calculate-gameweek", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ leagueId, gameweekId }),
                  });
                  const payload = await readJson<CalcResult>(response);
                  setCalculated(payload);
                  setReset(null);
                  setVotesStamp((stamp) => stamp + 1);
                  const lab = await reload();
                  chooseGameweek(gameweekId, lab);
                })}
              >
                Calcola i voti caricati
              </button>
              <Link className="ghost" href="/admin/import-voti">Carica voti ufficiali</Link>
              {pending === "Carico i voti di test…" ? <span className="muted">Scrivo un nuovo set di voti…</span> : null}
              {pending === "Simulo la giornata…" ? <span className="muted">Genero i voti e calcolo…</span> : null}
              {pending === "Annulla il calcolo…" ? <span className="muted">Tolgo punti e voti…</span> : null}
              {pending === "Calcolo i voti caricati…" ? <span className="muted">Calcolo i voti caricati…</span> : null}
              {pending === "Recupero i voti…" ? <span className="muted">Controllo le partite oltre i 130 minuti…</span> : null}
            </div>
            <p className="muted small">
              Recupera voti e calcola esegue lo stesso passaggio del calcolo automatico: scarica solo le partite iniziate da almeno 130 minuti e, quando la giornata è completa, calcola bonus, malus e sostituzioni. Poi apri Audit calcolo sulla squadra.
            </p>
            {matchdayRun ? (
              <p className={matchdayRun.votes.errors.length > 0 ? "banner" : "banner ok"}>
                {matchdaySummary(matchdayRun)}
              </p>
            ) : null}
            <p className="muted small">
              Carica voti di test scrive un set nuovo a ogni clic e sostituisce i voti di questa giornata.
              Chiudi giornata e calcola ne genera un altro e mostra subito il punteggio di ogni squadra.
              Per i risultati veri: annulla il calcolo, carica i voti ufficiali, segna le partite finite nel calendario
              e premi Calcola i voti caricati.
            </p>
            {testVotes ? (
              <p className="banner ok">
                Giornata {testVotes.gameweekNumber}: caricati voti di test su {testVotes.rated} di {testVotes.listone} calciatori.
                Un altro clic ne scrive di diversi.
              </p>
            ) : null}
            {reset ? (
              <p className="banner ok">
                Giornata {reset.gameweekNumber}: tolti {reset.scoresCleared} totali e {reset.votesCleared} import di voti.
                Stato {reset.status}. I punti non contano più finché non ricalcoli.
                Le partite restano come sono. Carica i voti ufficiali e calcola di nuovo.
              </p>
            ) : null}
            {calculated ? (
              <p className="banner ok">
                Giornata {calculated.gameweekNumber} calcolata con i voti caricati. {calculated.teams} squadre in classifica.
              </p>
            ) : null}
            {sim ? (
              <div className="stack">
                <p className="banner ok">
                  Giornata {sim.gameweekNumber} in stato {sim.status}. Voti su {sim.ratedPlayers} di {sim.listone} calciatori,
                  {" "}{sim.teamsScored} squadre calcolate.
                  {" "}{sim.nextGameweekNumber
                    ? `La giornata ${sim.nextGameweekNumber} è aperta.`
                    : "Non c’è una giornata successiva da aprire."}
                </p>
              </div>
            ) : null}
          </>
        )}
      </article>
      ) : null}

      {labTab === "calendario" ? (
      <article className="card stack">
        <h2>Calendario {snapshot.seasonCode}</h2>
        <p>
          Partite della competizione attiva. Dopo l&apos;import, le partite si segnano da sole due ore dopo il calcio d&apos;inizio.
          Aggiorna orari e risultati legge Sky, per la Serie A, e scrive il punteggio delle gare già finite.
          Sulla riga puoi correggere risultato e stato a mano: in programma oppure finita.
        </p>
        <p className="muted small">
          Gli orari pubblicati sono quelli della prima giornata, di Napoli-Como e di tutte le gare dal turno 11.
          Le giornate lontane hanno ancora lo stesso orario su tutte le partite: Sky lo precisa avvicinandosi al turno.
          Il job settimanale e il pulsante qui sotto rileggono quegli orari. Un orario che salvi a mano resta fermo.
        </p>
        <div className="row">
          <button
            className="primary"
            type="button"
            disabled={busy || snapshot.leagues.length === 0}
            onClick={() => run("Importo il calendario…", async () => {
              const response = await fetch("/api/admin/import-calendar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              });
              const payload = await readJson<CalendarImport>(response);
              setCalendar(payload);
              const lab = await reload();
              chooseGameweek(gameweekId, lab);
            })}
          >
            Importa calendario Serie A 2026/27
          </button>
          <button
            className="ghost"
            type="button"
            disabled={busy || !gameweekId}
            onClick={() => run("Segno le partite…", async () => {
              const response = await fetch("/api/admin/matches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gameweekId, status: "finished" }),
              });
              await readJson(response);
              setBoardStamp((value) => value + 1);
            })}
          >
            Segna tutte finite
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy || snapshot.leagues.length === 0}
            onClick={() => run("Aggiorno gli orari…", async () => {
              const response = await fetch("/api/admin/refresh-kickoffs", { method: "POST" });
              const payload = await readJson<KickoffRefresh>(response);
              setRefresh(payload);
              const lab = await reload();
              chooseGameweek(gameweekId, lab);
            })}
          >
            Aggiorna orari e risultati
          </button>
        </div>
        <div className="row admin-controls">
          <label>
            Inizio giornata
            <input
              type="datetime-local"
              value={startDraft}
              onChange={(event) => setStartDraft(event.target.value)}
            />
          </label>
          <button
            className="ghost"
            type="button"
            disabled={busy || !gameweekId || !startDraft}
            onClick={() => run("Salvo l'inizio…", async () => {
              const response = await fetch("/api/admin/gameweek-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gameweekId, kickoffLocal: startDraft }),
              });
              const payload = await readJson<StartSave>(response);
              setStartSave(payload);
              const lab = await reload();
              chooseGameweek(gameweekId, lab);
            })}
          >
            Salva inizio giornata
          </button>
        </div>
        <p className="muted small">
          L&apos;inizio giornata chiude le formazioni. Se lo salvi a mano, l&apos;aggiornamento online non lo sposta.
          Altrimenti è un minuto prima della prima partita della giornata.
        </p>
        {refresh ? (
          <p className="banner ok">
            {refresh.skipped
              ? refresh.reason
              : `Sky riletto su ${refresh.rounds} giornate. Orari aggiornati: ${refresh.updated}. Risultati segnati: ${refresh.results ?? 0}. Inizio giornata ricalcolato su ${refresh.deadlines}.`}
            {refresh.goalsColumn === false ? " Per vedere i punteggi esegui schema_sync.sql." : ""}
            {refresh.kept > 0 ? ` ${refresh.kept} orari già precisi o fissati a mano sono rimasti.` : ""}
            {refresh.lockColumn ? "" : " Per tenere fermo un orario salvato a mano esegui kickoff_refresh.sql."}
          </p>
        ) : null}
        {startSave ? (
          <p className="banner ok">
            Inizio della giornata {startSave.gameweekNumber} salvato.
            {startSave.protectedFromRefresh
              ? " L'aggiornamento online non lo sposta."
              : " Esegui calendar_setup.sql perché il prossimo aggiornamento non lo ricalcoli."}
          </p>
        ) : null}
        {calendar ? (
          <p className="banner ok">
            {calendar.rounds} giornate, {calendar.fixtures} partite. Deadline aggiornate su {calendar.deadlines} giornate
            ancora in programma. Orari pubblicati: {calendar.kickoffsWithPublishedTime}.
            Le gare già iniziate da più di due ore sono finite. Senza voti il calcolo non parte e la giornata chiusa vale zero,
            finché non la calcoli. Una giornata che hai tenuto aperta, con deadline nel futuro, resta modificabile.
          </p>
        ) : null}
        {matches.length === 0 ? (
          <p className="muted">Nessuna partita su questa giornata.</p>
        ) : (
          <ul className="score-list">
            {matches.map((match) => {
              const draft = scoreDrafts[match.id] ?? { home: "", away: "" };
              const saveMatch = (status: "scheduled" | "finished") => run("Salvo la partita…", async () => {
                const home = draft.home.trim();
                const away = draft.away.trim();
                const response = await fetch("/api/admin/matches", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    matchId: match.id,
                    status,
                    homeGoals: status === "finished" && home !== "" ? Number(home) : null,
                    awayGoals: status === "finished" && away !== "" ? Number(away) : null,
                  }),
                });
                await readJson(response);
                setBoardStamp((value) => value + 1);
              });
              return (
                <li key={match.id} className="score-row">
                  <strong>{match.home}</strong>
                  <span className="score-result">
                    <input
                      inputMode="numeric"
                      aria-label={`Gol ${match.home}`}
                      value={draft.home}
                      onChange={(event) => setScoreDrafts((current) => ({
                        ...current,
                        [match.id]: { ...draft, home: event.target.value.replace(/[^\d]/g, "") },
                      }))}
                    />
                    <span className="muted">–</span>
                    <input
                      inputMode="numeric"
                      aria-label={`Gol ${match.away}`}
                      value={draft.away}
                      onChange={(event) => setScoreDrafts((current) => ({
                        ...current,
                        [match.id]: { ...draft, away: event.target.value.replace(/[^\d]/g, "") },
                      }))}
                    />
                  </span>
                  <strong className="score-away">{match.away}</strong>
                  <span className="muted small score-time">
                    {kickoffLabel(match.kickoffAt)}
                    {match.kickoffLocked ? " · fisso" : ""}
                  </span>
                  <span className="score-actions">
                    <span className="status-pill">{MATCH_LABEL[match.status] ?? match.status}</span>
                    <button className="ghost" type="button" disabled={busy} onClick={() => saveMatch("scheduled")}>
                      In programma
                    </button>
                    <button className="ghost" type="button" disabled={busy} onClick={() => saveMatch("finished")}>
                      Finita
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingKickoff((current) => current === match.id ? null : match.id)}
                    >
                      Orario
                    </button>
                  </span>
                  {editingKickoff === match.id ? (
                    <span className="score-kickoff">
                      <input
                        type="datetime-local"
                        value={kickoffDrafts[match.id] ?? romeInput(match.kickoffAt)}
                        disabled={match.status !== "scheduled" || busy}
                        onChange={(event) => setKickoffDrafts((current) => ({ ...current, [match.id]: event.target.value }))}
                      />
                      <button
                        className="ghost"
                        type="button"
                        disabled={busy || match.status !== "scheduled"}
                        onClick={() => run("Salvo l'orario…", async () => {
                          const response = await fetch("/api/admin/match-kickoff", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ matchId: match.id, kickoffLocal: kickoffDrafts[match.id] }),
                          });
                          await readJson(response);
                          setEditingKickoff(null);
                          setBoardStamp((value) => value + 1);
                        })}
                      >
                        Salva orario
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </article>
      ) : null}

      {labTab === "squadre" ? (
      <article className="card stack">
        <h2>Ingresso in corsa</h2>
        <p>
          Iscrive una squadra nuova la cui prima formazione è la giornata scelta. Le giornate precedenti
          del range vengono ricalcolate senza di lei, poi la giornata di ingresso viene calcolata con la
          sua formazione. Per le giornate saltate riceve la media dei punteggi di tutte le squadre in quelle giornate, poi somma i punti reali.
        </p>
        <label>
          Giornata di ingresso
          <input
            type="number"
            min={entryBounds.min}
            max={entryBounds.max}
            value={entry}
            onChange={(event) => setEntry(Number(event.target.value))}
          />
        </label>
        <div className="row">
          <button
            className="primary"
            type="button"
            disabled={busy || !leagueId}
            onClick={() => run("Verifico l'ingresso…", async () => {
              const response = await fetch("/api/admin/late-join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leagueId, gameweekNumber: entry }),
              });
              const payload = await readJson<{ report: LateJoinReport }>(response);
              setLate(payload.report);
              const lab = await reload();
              const refreshed = lab.gameweeks.find((item) => item.number === entry);
              if (refreshed) chooseGameweek(refreshed.id, lab);
            })}
          >
            Iscrivi alla giornata e verifica
          </button>
          {pending === "Verifico l'ingresso…" ? (
            <span className="muted">Calcolo le giornate precedenti e controllo la classifica…</span>
          ) : null}
        </div>
        {late ? (
          <div className="stack">
            <p className={late.ok ? "banner ok" : "banner"}>
              {late.ok
                ? `${late.teamName} rispetta l'ingresso in media.`
                : `${late.teamName} non torna con la regola di ingresso.`}
            </p>
            {late.standing ? (
              <table className="standings">
                <thead>
                  <tr>
                    <th>Pos</th>
                    <th>Squadra</th>
                    <th>Punti</th>
                    <th>Reali</th>
                    <th>Ingresso</th>
                    <th>Disputate</th>
                    <th>Saltate</th>
                    <th>Media</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{late.standing.rank}</td>
                    <td>{late.standing.teamName}</td>
                    <td>{late.standing.points}</td>
                    <td>{late.standing.realPoints}</td>
                    <td>{late.standing.entryPoints}</td>
                    <td>{late.standing.played}</td>
                    <td>{late.standing.skipped}</td>
                    <td>{late.standing.average ?? "—"}</td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            <ul className="list">
              {late.notes.map((note) => (
                <li key={note} className="person">{note}</li>
              ))}
            </ul>
            <p className="muted small">
              {late.email} · password {late.password}. Giornate preparate: {late.weeksPrepared.join(", ") || "nessuna"}.
              Saltate attese: {late.expectedSkipped}.
            </p>
          </div>
        ) : null}
      </article>
      ) : null}

      {auditTeamId ? (
        <ScoreAuditDialog
          key={auditTeamId}
          leagueId={leagueId}
          gameweekId={gameweekId}
          gameweekNumber={gameweek?.number ?? null}
          teams={auditTeams.length > 0 ? auditTeams : [{ id: auditTeamId, name: "Squadra" }]}
          initialTeamId={auditTeamId}
          onClose={() => setAuditTeamId(null)}
        />
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
    </div>
  );
}
