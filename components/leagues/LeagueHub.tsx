"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { EmptyState } from "@/components/EmptyState";
import { LeagueAdminPanel } from "@/components/leagues/LeagueAdminPanel";
import { LeagueRulesReadout } from "@/components/leagues/LeagueRulesReadout";
import { LeagueBoard } from "@/components/leagues/LeagueBoard";
import { MatchCenter } from "@/components/leagues/MatchCenter";
import { MatchdayResults } from "@/components/leagues/MatchdayResults";
import { MyPagelle } from "@/components/leagues/MyPagelle";
import { Pitch } from "@/components/leagues/Pitch";
import { TeamBadge } from "@/components/TeamBadge";
import { AvailabilityBadge, isUnavailable } from "@/components/lineups/AvailabilityBadge";
import { CompactLineup, type CompactPlayer } from "@/components/lineups/CompactLineup";
import { WheelPicker } from "@/components/lineups/WheelPicker";
import { BenchOrder } from "@/components/lineups/BenchOrder";
import {
  FORMATIONS,
  autoLineup,
  countRoles,
  formationById,
  formationIssue,
  inferFormation,
  roleCap,
  trimToFormation,
  type FormationId,
} from "@/lib/formations";
import { isHubTab, LEAGUE_TAB_EVENT, type HubTab } from "@/lib/hub-tabs";
import { InfoTip } from "@/components/InfoTip";
import type { LeagueRules } from "@/lib/league-rules";
import type { CatalogPlayer, LeagueDetail, LeagueHubData, LiveLineupSheet, OpponentLineup, PlayerRole, SavedLineup } from "@/lib/types";
import { RegulationPanel } from "@/components/rules/RegulationView";
import { ROLE_LABEL } from "@/lib/types";
import { useTapGuard } from "@/components/useTapGuard";
import { pushToast } from "@/lib/toast";
import { triggerHaptic } from "@/lib/native/bridge";
import { readAction, readableError } from "@/lib/feedback";

const BENCH_ROLES: PlayerRole[] = ["GK", "DEF", "MID", "FWD"];
const ROLE_LETTER: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };
const deadlineFormat = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

async function readJson<T>(response: Response): Promise<T> {
  return readAction<T>(response);
}

/**
 * Chiusa la formazione vale solo quella salvata: proposte e modifiche in sospeso non contano.
 * Senza formazione salvata vale quella d'ufficio, la stessa che registrerà il calcolo.
 */
function savedPick(hub: LeagueHubData): LeagueHubData["lineup"] {
  return hub.lineupOrigin === "saved" || hub.lineupOrigin === "office"
    ? hub.lineup
    : { playerIds: [], benchIds: [], captainId: null, viceId: null };
}

function formatPoints(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LeagueHomeView({
  home,
  standings,
  history,
  mineId,
  onLineup,
}: {
  home: LeagueHubData["home"];
  standings: LeagueHubData["standings"];
  history: LeagueHubData["checkpointHistory"];
  mineId: string | null;
  onLineup: () => void;
}) {
  return (
    <section className="home-grid">
      <article className="card home-span">
        {home.phase === "countdown" && home.deadlineAt && home.gameweekNumber ? (
          <DeadlineClock
            deadlineAt={home.deadlineAt}
            gameweekNumber={home.gameweekNumber}
            lineupSaved={home.lineupSaved}
            lineupSavedAt={home.lineupSavedAt}
            onLineup={onLineup}
          />
        ) : home.phase === "live" && home.gameweekNumber ? (
          <div className="stack">
            <h2>Giornata {home.gameweekNumber} in corso</h2>
            <p className="lock-badge">Formazione bloccata - Giornata in corso</p>
            <p className="small muted">
              {savedLine(home.lineupSaved, home.lineupSavedAt)}
              <InfoTip label="Giornata in corso">La formazione si apre per consultarla. Il countdown della prossima giornata parte quando questa è finita.</InfoTip>
            </p>
            <button className="primary" type="button" onClick={onLineup}>Apri la formazione</button>
          </div>
        ) : (
          <>
            <h2>Nessuna giornata aperta</h2>
            <EmptyState title="Calendario fermo">
              Questa lega non ha una giornata da preparare. Quando il turno successivo è in programma, qui compare il countdown e puoi schierare.
            </EmptyState>
          </>
        )}
      </article>
      <article className="card">
        <h2>Ultima giornata{home.lastRoundNumber ? ` · ${home.lastRoundNumber}` : ""}</h2>
        {home.lastRoundNumber ? (
          <MiniTable rows={home.lastRound} mineId={mineId} empty="Nessun punteggio pubblicato per questa giornata." />
        ) : (
          <EmptyState title="Nessun risultato">
            La prima giornata non è ancora stata calcolata. Voti, bonus e punti compariranno qui dopo la chiusura.
          </EmptyState>
        )}
      </article>
      <article className="card">
        <h2>Classifica generale</h2>
        {standings.length === 0 ? (
          <EmptyState title="Classifica vuota">
            Non c&apos;è ancora nessuna squadra. Invita con il codice dalla scheda Lega.
          </EmptyState>
        ) : !home.lastRoundNumber && standings.every((row) => row.played === 0 && row.points === 0) ? (
          <EmptyState title="Classifica in attesa della giornata 1" action={<button className="primary" type="button" onClick={onLineup}>Apri la formazione</button>}>
            I punti partono dopo la prima giornata calcolata. Schiera la formazione prima della deadline.
          </EmptyState>
        ) : (
          <MiniTable rows={standings} mineId={mineId} empty="Nessuna squadra iscritta." />
        )}
      </article>
      <CheckpointHistoryCard history={history} hasTeam={mineId !== null} />
    </section>
  );
}

function signedPoints(value: number) {
  const text = formatPoints(value);
  return value > 0 ? `+${text}` : text;
}

function CheckpointHistoryCard({
  history,
  hasTeam,
}: {
  history: LeagueHubData["checkpointHistory"];
  hasTeam: boolean;
}) {
  const peak = history.rows.reduce((max, row) => Math.max(max, row.points), 0);
  const floor = history.rows.reduce((min, row) => Math.min(min, row.points), 0);
  const span = Math.max(peak - Math.min(floor, 0), 1);
  return (
    <article className="card home-span checkpoint-history">
      <h2>Storico checkpoint</h2>
      {history.rows.length > 0 ? (
        <>
          <InfoTip label="Storico checkpoint">Punti, bonus, malus e posizione della squadra alla chiusura di ogni finestra di mercato.</InfoTip>
          <div className="checkpoint-bars" aria-hidden="true">
            {history.rows.map((row) => (
              <div key={row.afterMatchday}>
                <span style={{ height: `${Math.max(8, ((row.points - Math.min(floor, 0)) / span) * 100)}%` }} />
                <small>{row.afterMatchday}</small>
              </div>
            ))}
          </div>
          <div className="mobile-cards">
            {history.rows.map((row, index) => (
              <article className="person-card" key={row.afterMatchday}>
                <strong>Checkpoint {index + 1}</strong>
                <div className="person-card-meta">
                  <span className="status-pill">Chiuso · dopo la {row.afterMatchday}</span>
                  <span className="badge">{row.rank}° su {row.teams}</span>
                </div>
                <p className="small">
                  Punti {formatPoints(row.points)} · Bonus {signedPoints(row.bonus)} · Malus {signedPoints(row.malus)}
                </p>
              </article>
            ))}
          </div>
          <table className="standings as-cards hide-on-phone">
            <thead>
              <tr>
                <th>Checkpoint</th>
                <th>Giornata</th>
                <th>Punti</th>
                <th>Bonus</th>
                <th>Malus</th>
                <th>Posizione</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row, index) => (
                <tr key={row.afterMatchday}>
                  <td data-label="Checkpoint">{index + 1}°</td>
                  <td data-label="Giornata">Dopo la {row.afterMatchday}</td>
                  <td data-label="Punti">{formatPoints(row.points)}</td>
                  <td data-label="Bonus">{signedPoints(row.bonus)}</td>
                  <td data-label="Malus">{signedPoints(row.malus)}</td>
                  <td data-label="Posizione">{row.rank}° su {row.teams}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : !history.configured ? (
        <EmptyState title="Nessun checkpoint">
          Questa lega non ha finestre di mercato. Si aggiungono in Gestione, indicando dopo quale giornata si possono fare i cambi.
        </EmptyState>
      ) : !hasTeam ? (
        <EmptyState title="Rosa mancante">
          Crea la rosa di questa stagione per vedere i punti della squadra a ogni checkpoint.
        </EmptyState>
      ) : history.nextAfter ? (
        <EmptyState title="Nessun checkpoint chiuso">
          Il primo si completa quando la giornata {history.nextAfter} è calcolata. Fino a quel momento la classifica non ha ancora uno storico da fissare.
        </EmptyState>
      ) : (
        <EmptyState title="Storico non disponibile">
          I checkpoint di questa lega non cadono su una giornata già calcolata.
        </EmptyState>
      )}
    </article>
  );
}

function DeadlineClock({
  deadlineAt,
  gameweekNumber,
  lineupSaved,
  lineupSavedAt,
  onLineup,
}: {
  deadlineAt: string;
  gameweekNumber: number;
  lineupSaved: boolean;
  lineupSavedAt: string | null;
  onLineup: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);
  const remaining = new Date(deadlineAt).getTime() - now;
  const open = mounted && remaining > 0;
  const savedText = savedLine(lineupSaved, lineupSavedAt);
  return (
    <div className="stack">
      <h2>{mounted && !open ? `Giornata ${gameweekNumber} in corso` : `Schiera prima della giornata ${gameweekNumber}`}</h2>
      {mounted && open ? <p className="countdown">{formatRemaining(remaining)}</p> : mounted ? (
        <>
          <p className="lock-badge">Formazione bloccata - Giornata in corso</p>
          <p className="small muted">Il countdown della prossima giornata parte quando questa è finita.</p>
        </>
      ) : (
        <p className="countdown">––g ––h ––m ––s</p>
      )}
      <p className="small muted">
        {mounted && open ? `Deadline ${deadlineFormat.format(new Date(deadlineAt))}. ` : null}
        {savedText}
      </p>
      <button className="primary" type="button" onClick={onLineup}>Apri la formazione</button>
    </div>
  );
}

function savedLine(lineupSaved: boolean, lineupSavedAt: string | null) {
  if (!lineupSaved) return "La formazione non è ancora salvata.";
  if (lineupSavedAt) return `Formazione salvata ${formatSavedAt(lineupSavedAt)}.`;
  return "Formazione già salvata. Giorno e ora compaiono dal prossimo salvataggio.";
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

function formatRemaining(remaining: number) {
  const total = Math.floor(remaining / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(days)}g ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

function MiniTable({
  rows,
  mineId,
  empty,
}: {
  rows: { rank: number; fantasyTeamId: string; teamName: string; displayName: string; points: number | null }[];
  mineId: string | null;
  empty: string;
}) {
  if (rows.length === 0) return <p className="small muted">{empty}</p>;
  return (
    <table className="standings as-cards">
      <thead>
        <tr>
          <th>Pos</th>
          <th>Squadra</th>
          <th>Punti</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.fantasyTeamId} data-mine={row.fantasyTeamId === mineId}>
            <td data-label="Pos">{row.rank || "—"}</td>
            <td data-label="Squadra">
              <strong>{row.teamName}</strong>
              {row.displayName ? <span className="small muted"> · {row.displayName}</span> : null}
            </td>
            <td data-label="Punti">{formatPoints(row.points)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LeagueHub({
  initial,
  allowTestFill = false,
  hostMode = false,
  initialTab = "home",
  initialRound,
}: {
  initial: LeagueHubData;
  allowTestFill?: boolean;
  hostMode?: boolean;
  initialTab?: HubTab;
  /** Giornata da mostrare in «Risultati di giornata» quando si arriva da un link. */
  initialRound?: number;
}) {
  const [hub, setHub] = useState(initial);
  const [tab, setTab] = useState<HubTab>(initialTab);
  const shownTab = tab === "gestione" ? "lega" : tab;
  const [board, setBoard] = useState<"parziale" | "generale" | "live">("generale");
  const [boardQuery, setBoardQuery] = useState("");
  const roundLive = hub.home.phase === "live";
  const [playerIds, setPlayerIds] = useState(initial.lineup.playerIds);
  const [benchIds, setBenchIds] = useState(initial.lineup.benchIds);
  const [pickerRole, setPickerRole] = useState<PlayerRole | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [formationId, setFormationId] = useState<FormationId>(
    inferFormation(countRoles(initial.roster, initial.lineup.playerIds)).id,
  );
  const [captainId, setCaptainId] = useState(initial.lineup.captainId);
  const [viceId, setViceId] = useState(initial.lineup.viceId);
  const [armOpen, setArmOpen] = useState<"captain" | "vice" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [squads, setSquads] = useState(initial.squads);
  const [squadsLoading, setSquadsLoading] = useState(false);
  const flight = useRef(false);
  /** Salvataggi formazione in fila: partono uno alla volta, vince l'ultimo. */
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const lastSent = useRef<string | null>(null);
  const [shownAsSaved, setShownAsSaved] = useState<string | null>(null);
  const picks = useTapGuard();
  const [now, setNow] = useState(() => Date.now());
  const [closedNote, setClosedNote] = useState<string | null>(null);
  /** La giornata che era modificabile e quella già mostrata come chiusa. */
  const editableWeek = useRef<string | null>(null);
  const closedWeek = useRef<string | null>(null);
  const latestHub = useRef(initial);
  latestHub.current = hub;
  const onScreen = useRef("");
  onScreen.current = JSON.stringify([playerIds, benchIds, captainId, viceId]);

  useEffect(() => {
    void fetch("/api/active-league", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId: initial.league.id }),
    });
  }, [initial.league.id]);

  useEffect(() => {
    setHub(initial);
    setSquads(initial.squads);
    if (!initial.editable) showPick(savedPick(initial), initial.roster);
  }, [initial]);

  const selected = hub.gameweeks.find((gameweek) => gameweek.id === hub.selectedGameweekId) ?? null;
  const mineId = hub.opponents.find((opponent) => opponent.isMine)?.fantasyTeamId ?? null;

  useEffect(() => {
    function onTab(event: Event) {
      const nextTab = (event as CustomEvent<string>).detail;
      if (isHubTab(nextTab)) setTab(nextTab === "gestione" ? "lega" : nextTab);
    }
    function onPop() {
      const nextTab = new URLSearchParams(window.location.search).get("tab") ?? undefined;
      if (isHubTab(nextTab)) setTab(nextTab);
    }
    window.addEventListener(LEAGUE_TAB_EVENT, onTab);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener(LEAGUE_TAB_EVENT, onTab);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  const next = hub.gameweeks.find((gameweek) => gameweek.isNext) ?? null;
  const countdownOpen = hub.home.phase === "countdown"
    && Boolean(hub.home.deadlineAt)
    && new Date(hub.home.deadlineAt ?? 0).getTime() > now;
  const selectedStarted = Boolean(
    selected
    && selected.status !== "scored"
    && selected.status !== "final"
    && (
      selected.locked
      || new Date(selected.deadlineAt).getTime() <= now
      || (hub.home.phase === "live" && hub.home.gameweekNumber === selected.number)
    ),
  );
  const canEdit = hub.editable && countdownOpen && !selectedStarted;

  // Panchina sempre completa: chi non è in campo entra in fondo alla panchina, poi si riordina trascinando.
  useEffect(() => {
    if (!canEdit) return;
    const missing = hub.roster
      .filter((player) => !playerIds.includes(player.id) && !benchIds.includes(player.id))
      .sort((left, right) => BENCH_ROLES.indexOf(left.role) - BENCH_ROLES.indexOf(right.role))
      .map((player) => player.id);
    if (missing.length > 0) setBenchIds((current) => [...current, ...missing.filter((id) => !current.includes(id))]);
  }, [canEdit, hub.roster, playerIds, benchIds]);

  useEffect(() => {
    if (!roundLive && board === "live") setBoard("generale");
  }, [roundLive, board]);

  useEffect(() => {
    if (shownTab !== "squadre") return;
    let cancelled = false;
    setSquadsLoading(true);
    const week = selected?.number ?? "";
    void fetch(`/api/leagues/${hub.league.id}/squads?gameweek=${week}`)
      .then(async (response) => {
        const body = await response.json() as { squads?: typeof squads; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Rose non disponibili.");
        if (!cancelled) setSquads(body.squads ?? []);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(readableError(reason, "Rose non disponibili."));
      })
      .finally(() => {
        if (!cancelled) setSquadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shownTab, selected?.number, hub.league.id]);

  useEffect(() => {
    if (hub.home.phase !== "countdown" || !hub.home.deadlineAt) return;
    const remaining = new Date(hub.home.deadlineAt).getTime() - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 250);
    // Sul telefono il conto alla rovescia si ferma in background: al rientro si ricontrolla l'ora.
    const wake = () => setNow(Date.now());
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [hub.home.phase, hub.home.deadlineAt]);

  // Quando la formazione si chiude si mostra quello che il server ha davvero.
  useEffect(() => {
    const week = hub.selectedGameweekId;
    if (canEdit) {
      editableWeek.current = week;
      return;
    }
    if (!week || (!hub.editable && editableWeek.current !== week) || closedWeek.current === week) return;
    closedWeek.current = week;
    void showSavedLineup();
  }, [canEdit, hub.editable, hub.selectedGameweekId]);

  function showPick(pick: LeagueHubData["lineup"], roster: CatalogPlayer[]) {
    setPlayerIds(pick.playerIds);
    setBenchIds(pick.benchIds);
    setPickerRole(null);
    setReplacingId(null);
    setFormationId(inferFormation(countRoles(roster, pick.playerIds)).id);
    setCaptainId(pick.captainId);
    setViceId(pick.viceId);
  }

  function applyHub(nextHub: LeagueHubData) {
    setHub(nextHub);
    setClosedNote(null);
    showPick(nextHub.editable ? nextHub.lineup : savedPick(nextHub), nextHub.roster);
  }

  async function showSavedLineup() {
    const shown = onScreen.current;
    // Un invio partito prima della chiusura può ancora arrivare: si aspetta il suo esito.
    await saveQueue.current;
    let latest = latestHub.current;
    showPick(savedPick(latest), latest.roster);
    setMessage(null);
    try {
      const body = await readJson<{ hub: LeagueHubData }>(
        await fetch(`/api/leagues/${latest.league.id}/hub?gameweek=${latest.selectedGameweekId}`),
      );
      latest = body.hub;
      applyHub(latest);
    } catch {
      // Senza rete resta l'ultima formazione salvata già ricevuta.
    }
    const saved = savedPick(latest);
    showPick(saved, latest.roster);
    const same = shown === JSON.stringify([saved.playerIds, saved.benchIds, saved.captainId, saved.viceId]);
    setClosedNote(latest.lineupOrigin === "office"
      ? "Tempo scaduto: per questa giornata non risulta una formazione salvata. Vale quella d'ufficio."
      : latest.lineupOrigin !== "saved"
      ? "Tempo scaduto: per questa giornata non risulta una formazione salvata."
      : same
        ? "Tempo scaduto: questa è la formazione salvata."
        : "Tempo scaduto: le modifiche non salvate non valgono. Questa è la formazione salvata.");
  }

  async function openGameweek(gameweekId: string, stay?: HubTab) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const body = await readJson<{ hub: LeagueHubData }>(
        await fetch(`/api/leagues/${hub.league.id}/hub?gameweek=${gameweekId}`),
      );
      applyHub(body.hub);
      setTab((current) => stay ?? (current === "formazioni" || current === "risultati" ? current : "formazione"));
    } catch (reason) {
      setError(readableError(reason, "Giornata non disponibile."));
    } finally {
      setPending(false);
    }
  }

  function chooseFormation(nextId: FormationId) {
    if (!canEdit || pending) return;
    picks.hold(nextId, () => {
    const nextIds = trimToFormation(hub.roster, playerIds, formationById(nextId));
    setFormationId(nextId);
    setPlayerIds(nextIds);
    setBenchIds(benchIds.filter((id) => !nextIds.includes(id)));
    if (captainId && !nextIds.includes(captainId)) setCaptainId(null);
    if (viceId && !nextIds.includes(viceId)) setViceId(null);
    });
  }

  function place(player: CatalogPlayer) {
    if (!canEdit || pending || playerIds.includes(player.id)) return;
    picks.occupy(player.id, () => {
    const formation = formationById(formationId);
    const used = hub.roster.filter((item) => playerIds.includes(item.id) && item.role === player.role).length;
    if (used >= roleCap(formation, player.role) || playerIds.length >= 11) return;
    setPlayerIds([...playerIds, player.id]);
    setBenchIds(benchIds.filter((id) => id !== player.id));
    setPickerRole(null);
    setReplacingId(null);
    if (isUnavailable(player)) pushToast("err", "Attenzione: giocatore indisponibile per questo turno.");
    });
  }

  function replaceStarter(incoming: CatalogPlayer) {
    if (!canEdit || pending || !replacingId || incoming.id === replacingId) return;
    picks.occupy(incoming.id, () => {
    const outgoing = hub.roster.find((player) => player.id === replacingId);
    if (!outgoing || incoming.role !== outgoing.role || !playerIds.includes(replacingId)) return;
    setPlayerIds(playerIds.map((id) => (id === replacingId ? incoming.id : id)));
    // Scambio: chi esce prende in panchina il posto di chi entra.
    setBenchIds(benchIds.includes(incoming.id)
      ? benchIds.map((id) => (id === incoming.id ? outgoing.id : id))
      : benchIds);
    if (captainId === replacingId) setCaptainId(null);
    if (viceId === replacingId) setViceId(null);
    setReplacingId(null);
    if (isUnavailable(incoming)) pushToast("err", "Attenzione: giocatore indisponibile per questo turno.");
    });
  }

  function addToBench(player: CatalogPlayer) {
    if (!canEdit || pending || playerIds.includes(player.id) || benchIds.includes(player.id)) return;
    picks.occupy(player.id, () => {
      setBenchIds([...benchIds, player.id]);
      if (isUnavailable(player)) pushToast("err", "Attenzione: giocatore indisponibile per questo turno.");
    });
  }

  function moveBench(from: number, to: number) {
    if (!canEdit || pending || picks.locked) return;
    if (from === to || from < 0 || to < 0 || from >= benchIds.length || to >= benchIds.length) return;
    const next = [...benchIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBenchIds(next);
  }

  function clearPitch() {
    if (!canEdit || pending) return;
    picks.hold("clear", () => {
    setPlayerIds([]);
    setBenchIds([]);
    setCaptainId(null);
    setViceId(null);
    setPickerRole(null);
    setReplacingId(null);
    setError(null);
    setMessage("Campo svuotato. L'ultima formazione salvata resta: la ritrovi nel tab Formazioni e riapre la giornata successiva.");
    });
  }

  function mark(playerId: string, kind: "captain" | "vice") {
    if (!canEdit || pending || !playerIds.includes(playerId)) return;
    picks.hold(`${kind}:${playerId}`, () => {
    if (kind === "captain") {
      setCaptainId(playerId);
      if (viceId === playerId) setViceId(null);
      return;
    }
    if (playerId === captainId) return;
    setViceId(playerId);
    });
  }

  async function fileTestLineup() {
    if (!selected || !canEdit || !allowTestFill || flight.current || pending) return;
    const picked = autoLineup(hub.roster);
    if (!picked) {
      pushToast("err", "In rosa non c'è un modulo valido da schierare.");
      return;
    }
    const issue = formationIssue(hub.roster, picked.playerIds);
    if (issue) {
      pushToast("err", issue);
      return;
    }
    setFormationId(picked.formationId);
    setPlayerIds(picked.playerIds);
    setBenchIds(picked.benchIds);
    setCaptainId(picked.captainId);
    setViceId(picked.viceId);
    setPickerRole(null);
    setReplacingId(null);
    flight.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const body = await readJson<{ saved: SavedLineup }>(await fetch(`/api/leagues/${hub.league.id}/lineup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameweekId: selected.id,
          playerIds: picked.playerIds,
          benchIds: picked.benchIds,
          captainId: picked.captainId,
          viceId: picked.viceId,
        }),
      }));
      markSaved(selected.id, body.saved);
      void refreshAfterSave(selected.id);
      setMessage("Formazione di test schierata e salvata.");
      pushToast("ok", "Formazione di test schierata e salvata.");
    } catch (reason) {
      const text = readableError(reason, "Schieramento di test non riuscito.");
      setError(text);
      pushToast("err", text);
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  function saveLineup() {
    if (flight.current || pending) return;
    if (!selected || !canEdit) return;
    if (saveBlocked) {
      pushToast("err", `Non posso salvare perché ${saveReason}.`);
      return;
    }
    if (shapeIssue) {
      pushToast("err", shapeIssue);
      return;
    }
    const gameweekId = selected.id;
    const number = selected.number;
    const body = lineupBody;
    // La conferma compare subito; se il server rifiuta, arriva un avviso rosso.
    setError(null);
    setMessage(null);
    setShownAsSaved(body);
    pushToast("ok", `Formazione salvata per la giornata ${number}.`);
    void triggerHaptic();
    if (lastSent.current === body) return;
    lastSent.current = body;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const result = await readJson<{ saved: SavedLineup }>(await fetch(`/api/leagues/${hub.league.id}/lineup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          // L'invio arriva in fondo anche se si chiude o si cambia pagina.
          keepalive: true,
        }));
        markSaved(gameweekId, result.saved);
        if (lastSent.current !== body) return;
        lastSent.current = null;
        setError(null);
        void refreshAfterSave(gameweekId);
      } catch (reason) {
        // Se è già in coda un salvataggio più recente, conta l'esito di quello.
        if (lastSent.current !== body) return;
        lastSent.current = null;
        setShownAsSaved((current) => (current === body ? null : current));
        const detail = readableError(reason, "Riprova da questa schermata.");
        const text = `Formazione della giornata ${number} NON salvata. ${detail}`;
        setError(text);
        pushToast("err", text);
        if (/bloccata/i.test(detail) && closedWeek.current !== gameweekId) {
          closedWeek.current = gameweekId;
          // Senza attendere qui: la lettura aspetta la fine di questa coda.
          void showSavedLineup();
        }
      }
    });
  }

  /** Segna la formazione come salvata senza cambiare ciò che è sullo schermo. */
  function markSaved(gameweekId: string, saved: SavedLineup) {
    setHub((current) => current.selectedGameweekId !== gameweekId ? current : {
      ...current,
      lineup: saved.lineup,
      lineupOrigin: "saved",
      carriedFromMatchday: null,
      home: { ...current.home, lineupSaved: true, lineupSavedAt: saved.savedAt ?? current.home.lineupSavedAt },
    });
  }

  /** Dopo il salvataggio rilegge in sottofondo il resto della lega, senza toccare la formazione sullo schermo. */
  async function refreshAfterSave(gameweekId: string) {
    try {
      const body = await readJson<{ hub: LeagueHubData }>(
        await fetch(`/api/leagues/${hub.league.id}/hub?gameweek=${gameweekId}`),
      );
      setHub((current) => (current.selectedGameweekId === body.hub.selectedGameweekId ? body.hub : current));
    } catch {
      // La formazione è già salvata e mostrata: se questa lettura non riesce, si aggiorna alla prossima apertura.
    }
  }

  async function saveLeagueAdmin(input: {
    name: string;
    startMatchday: number;
    endMatchday: number;
    regenerateCode?: boolean;
    rules: LeagueRules;
  }) {
    if (flight.current) return;
    flight.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await readJson<{ league: LeagueDetail }>(await fetch(`/api/leagues/${hub.league.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }));
      const body = await readJson<{ hub: LeagueHubData }>(await fetch(`/api/leagues/${hub.league.id}/hub`));
      applyHub(body.hub);
      setMessage(input.regenerateCode ? "Nuovo codice invito generato." : "Impostazioni della lega salvate.");
    } catch (reason) {
      setError(readableError(reason, "Salvataggio non riuscito."));
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  async function grantDelegate(userId: string) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await readJson(await fetch(`/api/leagues/${hub.league.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantDelegateUserId: userId }),
      }));
      const body = await readJson<{ hub: LeagueHubData }>(await fetch(`/api/leagues/${hub.league.id}/hub`));
      applyHub(body.hub);
      setMessage("Admin delegato nominato. Il laboratorio globale resta del super admin.");
    } catch (reason) {
      setError(readableError(reason, "Nomina non riuscita."));
    } finally {
      setPending(false);
    }
  }

  async function revokeDelegate(userId: string) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await readJson(await fetch(`/api/leagues/${hub.league.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeDelegateUserId: userId }),
      }));
      const body = await readJson<{ hub: LeagueHubData }>(await fetch(`/api/leagues/${hub.league.id}/hub`));
      applyHub(body.hub);
      setMessage("Admin delegato rimosso.");
    } catch (reason) {
      setError(readableError(reason, "Revoca non riuscita."));
    } finally {
      setPending(false);
    }
  }

  async function remove(fantasyTeamId: string) {
    setPending(true);
    setError(null);
    try {
      await readJson(await fetch(`/api/leagues/${hub.league.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fantasyTeamId }),
      }));
      const body = await readJson<{ hub: LeagueHubData }>(await fetch(`/api/leagues/${hub.league.id}/hub`));
      applyHub(body.hub);
    } catch (reason) {
      setError(readableError(reason, "Rimozione non riuscita."));
    } finally {
      setPending(false);
    }
  }

  const shapeIssue = formationIssue(hub.roster, playerIds);
  const hasCaptain = Boolean(captainId && playerIds.includes(captainId));
  const hasVice = playerIds.length <= 1 || Boolean(viceId && viceId !== captainId && playerIds.includes(viceId));
  const missingCaptainOrVice = !hasCaptain || !hasVice;
  const formation = formationById(formationId);
  const bench = benchIds
    .map((id) => hub.roster.find((player) => player.id === id))
    .filter((player): player is CatalogPlayer => Boolean(player));
  const fielded = playerIds
    .map((id) => hub.roster.find((player) => player.id === id))
    .filter((player): player is CatalogPlayer => Boolean(player));
  const available = hub.roster.filter((player) => !playerIds.includes(player.id) && !benchIds.includes(player.id));
  const missingBench = available.length > 0;
  /** Ciò che si invierebbe premendo «Salva»: serve anche a sapere se sullo schermo è cambiato qualcosa. */
  const lineupBody = JSON.stringify({ gameweekId: selected?.id ?? null, playerIds, benchIds, captainId, viceId });
  const saveBlocked = missingCaptainOrVice || missingBench;
  const saveReason = [
    missingCaptainOrVice ? "manca capitano o vice" : "",
    missingBench ? "manca la panchina" : "",
  ].filter(Boolean).join(" e ");
  const pickerPlayers = pickerRole
    ? hub.roster.filter((player) => player.role === pickerRole && !playerIds.includes(player.id))
    : [];
  const replacing = hub.roster.find((player) => player.id === replacingId) ?? null;
  const replacementPlayers = replacing
    ? hub.roster.filter((player) => player.role === replacing.role && !playerIds.includes(player.id))
    : [];

  return (
    <div className="stack">
      {shownTab === "risultati" || shownTab === "classifica" ? (
        <header>
          <h1 className="section-title">{shownTab === "classifica" ? "Classifica" : "Risultati di giornata"}</h1>
        </header>
      ) : shownTab === "formazione" ? (
        <header className="lineup-head">
          <h1 className="section-title">Formazione</h1>
          {selected ? (
            <p className="small muted">
              Giornata {selected.number}{canEdit ? " · modificabile fino alla deadline" : ""}
            </p>
          ) : null}
        </header>
      ) : shownTab === "pagelle" ? null : (
      <header>
        <p className="small muted">
          {hub.league.seasonCode} · Giornate {hub.league.startMatchday}–{hub.league.endMatchday}
          {" · "}
          {hub.league.rules.format === "h2h" ? "1 contro 1" : hub.league.rules.format === "hybrid" ? "A fasi" : "Tutti contro tutti"}
          {" · "}
          {hub.league.rules.visibility === "public" ? "Pubblica" : "Privata"}
          {" · "}
          {hub.league.rules.defenseEnabled ? "Modificatore difesa" : "Senza modificatore difesa"}
          {hub.league.isManager || hostMode ? ` · ${hub.league.isOwner ? "Admin di lega" : hub.league.isManager ? "Admin delegato" : "Partecipante"}` : ""}
        </p>
        <div className="row page-head">
          <h1 className="section-title">{hub.league.name}</h1>
          <Link className="primary" href="/rosa">Cambia la mia rosa</Link>
        </div>
      </header>
      )}
      {hostMode && hub.league.platformOverride ? (
        <p className="banner">Super admin <InfoTip label="Vista super admin">Puoi cambiare regole e admin di questa lega. Il Laboratorio resta la correzione dei tabellini di stagione.</InfoTip></p>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      {message ? <p className="banner ok">{message}</p> : null}
      {shownTab === "risultati" || shownTab === "classifica" || shownTab === "formazione" || shownTab === "pagelle" ? null : <div className="tabs scroll-tabs" role="tablist" aria-label="Sezioni della lega">
        <button className="tab" type="button" data-active={shownTab === "home"} onClick={() => setTab("home")}>Home</button>
        <button className="tab" type="button" data-active={shownTab === "live"} onClick={() => setTab("live")}>Live</button>
        <button className="tab" type="button" data-active={shownTab === "bacheca"} onClick={() => setTab("bacheca")}>Bacheca</button>
        <button className="tab" type="button" data-active={shownTab === "squadre"} onClick={() => setTab("squadre")}>Squadre</button>
        <button className="tab" type="button" onClick={() => setTab("formazione")}>Formazione</button>
        <button className="tab" type="button" data-active={shownTab === "formazioni"} onClick={() => setTab("formazioni")}>Formazioni</button>
        <button className="tab" type="button" data-active={shownTab === "regolamento"} onClick={() => setTab("regolamento")}>Regolamento</button>
        <button className="tab" type="button" data-active={shownTab === "lega"} onClick={() => setTab("lega")}>Impostazioni</button>
      </div>}

      {tab !== "lega" && tab !== "home" && tab !== "regolamento" && tab !== "risultati" && tab !== "classifica" && tab !== "gestione" && tab !== "formazione" && tab !== "pagelle" ? (
        <GameweekBar
          gameweeks={hub.gameweeks}
          selectedId={selected?.id ?? null}
          pending={pending}
          onSelect={(gameweekId) => void openGameweek(gameweekId)}
        />
      ) : null}

      {shownTab === "live" ? <MatchCenter leagueId={hub.league.id} /> : null}
      {shownTab === "bacheca" ? <LeagueBoard leagueId={hub.league.id} /> : null}
      {shownTab === "home" ? (
        <LeagueHomeView
          home={hub.home}
          standings={hub.standings}
          history={hub.checkpointHistory}
          mineId={hub.opponents.find((opponent) => opponent.isMine)?.fantasyTeamId ?? null}
          onLineup={() => {
            const target = hub.home.focusGameweekId;
            if (target) {
              void openGameweek(target);
              return;
            }
            setTab("formazione");
          }}
        />
      ) : null}

      {shownTab === "squadre" ? (
        <section className="stack">
          {selected ? (
            <p className="small muted">Giornata {selected.number} <InfoTip label="Rose">Rose valide in questa giornata: portieri, difensori, centrocampisti e attaccanti.</InfoTip></p>
          ) : null}
          {squadsLoading ? <p className="small muted">Carico le rose...</p> : <Squads squads={squads} />}
        </section>
      ) : null}

      {shownTab === "formazione" ? (
        <section className="stack">
          {selected && selectedStarted ? (
            <p className="lock-badge">Formazione bloccata - Giornata in corso</p>
          ) : null}
          {closedNote ? <p className="banner" role="status">{closedNote}</p> : null}
          {selected && !canEdit && !selectedStarted ? (
            <p className="banner">
              {hub.liveSheet
                ? `Giornata ${selected.number} in corso. Il fantavoto è voto + bonus + malus. I voti arrivano a fine primo tempo e a fine partita.`
                : hub.home.phase === "live" || (hub.home.phase === "countdown" && !countdownOpen)
                  ? `Giornata ${hub.home.gameweekNumber ?? selected.number} in corso. La formazione si consulta. Il countdown della prossima parte a giornata finita.`
                  : hub.home.phase === "countdown" && next
                    ? `Questa giornata si consulta. La giornata ${next.number} è quella del countdown: lì si modifica la formazione.`
                    : "Questa giornata è chiusa. La formazione resta in consultazione."}
            </p>
          ) : null}

          {hub.lineupOrigin === "office" && !closedNote ? (
            <p className="banner" role="status">Non hai salvato la formazione: vale quella d'ufficio, cioè l'ultima salvata adattata alla rosa di questa giornata.</p>
          ) : null}
          {hub.liveSheet ? <PlayedLineup sheet={hub.liveSheet} /> : null}
          {hub.liveSheet ? null : (
            <section className="roster-main lineup-panel" data-pending={pending || picks.locked}>
              {canEdit && saveBlocked ? (
                <p className="banner">Non puoi salvare: {saveReason}.</p>
              ) : null}
              {hub.roster.length === 0 ? (
                <EmptyState title="Rosa mancante" action={<Link className="primary" href="/rosa">Vai alla rosa</Link>}>
                  Senza calciatori in rosa non puoi schierare.
                </EmptyState>
              ) : (
                <div className="lineup-field">
                  {canEdit ? (
                    <div className="lineup-tools">
                      <label className="module-pick">
                        <span>Modulo</span>
                        <select
                          aria-label="Modulo"
                          value={formationId}
                          disabled={pending || picks.locked}
                          onChange={(event) => chooseFormation(event.target.value as FormationId)}
                        >
                          {FORMATIONS.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
                        </select>
                      </label>
                      <p className="small muted">Tocca un giocatore per cambiarlo</p>
                    </div>
                  ) : null}
                  <Pitch
                    formation={formation}
                    players={hub.roster}
                    playerIds={playerIds}
                    captainId={captainId}
                    viceId={viceId}
                    editable={canEdit && !pending && !picks.locked}
                    onReplace={setReplacingId}
                    onPickRole={setPickerRole}
                  />
                  {shapeIssue ? <p className="small">{shapeIssue}</p> : null}
                </div>
              )}
              {fielded.length > 0 ? (
                <div className="arm-box lineup-card">
                  <div className="lineup-card-head">
                    <h2>Capitano e vice</h2>
                  </div>
                  {([["captain", "Capitano", captainId], ["vice", "Vice", viceId]] as const).map(([kind, label, chosenId]) => {
                    const chosen = fielded.find((player) => player.id === chosenId) ?? null;
                    const blocked = !canEdit || pending || picks.locked || (kind === "vice" && fielded.length < 2);
                    return (
                      <button
                        key={kind}
                        className="arm-pick"
                        type="button"
                        disabled={blocked}
                        data-empty={!chosen}
                        onClick={() => setArmOpen(kind)}
                      >
                        <em className="arm-mark">{kind === "captain" ? "C" : "V"}</em>
                        <span className="arm-label">{label}</span>
                        <strong>{chosen ? chosen.fullName : canEdit ? "Scegli" : "Nessuno"}</strong>
                        {canEdit ? <span className="arm-chevron" aria-hidden="true">›</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="lineup-card">
              <div className="lineup-card-head">
                <h2>Panchina</h2>
                <span>{bench.length}</span>
              </div>
              {canEdit && bench.length > 0 ? <p className="small muted">Entrano in quest'ordine. Trascina la maniglia ⋮⋮ per spostarli.</p> : null}
              {bench.length === 0 ? <p className="small">Nessuno in panchina.</p> : (
                <BenchOrder
                  players={bench}
                  editable={canEdit && !pending && !picks.locked}
                  onMove={moveBench}
                />
              )}
              {canEdit && available.length > 0 ? BENCH_ROLES.map((role) => {
                const players = available.filter((player) => player.role === role);
                if (players.length === 0) return null;
                return (
                  <div key={`avail-${role}`} className="bench-add">
                    <p className="bench-add-head"><span className="role-chip" data-role={role}>{ROLE_LETTER[role]}</span>Da aggiungere · {ROLE_LABEL[role]}</p>
                    <div className="side-list">
                      {players.map((player) => (
                        <button
                          className="side-row"
                          key={player.id}
                          type="button"
                          disabled={pending || picks.locked}
                          onClick={() => addToBench(player)}
                        >
                          <strong>{player.fullName}<AvailabilityBadge player={player} /></strong>
                          <span className="small muted"><TeamBadge teamName={player.clubShort} /> {player.clubShort}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }) : null}
              </div>
            </section>
          )}
          {canEdit && !hub.liveSheet ? (
            <div className="thumb-bar">
              <span
                className="save-lineup"
                data-blocked={saveBlocked}
                onClick={() => {
                  if (!pending && saveBlocked) pushToast("err", `Non posso salvare perché ${saveReason}.`);
                }}
              >
                <button className="primary" type="button" disabled={pending || picks.locked || saveBlocked} aria-busy={pending} onClick={saveLineup}>
                  <BusyLabel pending={pending} idle={shownAsSaved === lineupBody ? "✓ Salvata" : "Salva formazione"} busy="Salvataggio..." />
                </button>
              </span>
              <button
                className="ghost"
                type="button"
                disabled={pending || picks.locked || (playerIds.length === 0 && benchIds.length === 0)}
                aria-busy={picks.busyId === "clear"}
                onClick={clearPitch}
              >
                {picks.busyId === "clear" ? <span className="spinner" aria-hidden="true" /> : null}
                Svuota campo
              </button>
              {allowTestFill ? (
                <button className="ghost" type="button" disabled={pending || picks.locked || hub.roster.length === 0} onClick={() => void fileTestLineup()}>
                  Schiera di test
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {shownTab === "pagelle" ? (
        <MyPagelle
          leagueId={hub.league.id}
          gameweekId={[...hub.gameweeks].reverse().find((week) => week.status === "scored" || week.status === "final")?.id ?? ""}
          gameweekNumber={[...hub.gameweeks].reverse().find((week) => week.status === "scored" || week.status === "final")?.number ?? 0}
          fantasyTeamId={hub.opponents.find((team) => team.isMine)?.fantasyTeamId ?? ""}
        />
      ) : null}

      {shownTab === "formazioni" ? (
        <Formations
          opponents={[...hub.opponents].sort((left, right) => Number(right.isMine) - Number(left.isMine) || left.teamName.localeCompare(right.teamName, "it"))}
          revealed={hub.revealOpponents}
          gameweekNumber={selected?.number ?? null}
          carried={hub.lineupOrigin === "previous" && hub.carriedFromMatchday ? {
            from: hub.carriedFromMatchday,
            pick: hub.lineup,
            roster: hub.roster,
          } : null}
        />
      ) : null}

      {shownTab === "risultati" ? (
        <MatchdayResults hub={hub} initialRound={initialRound} />
      ) : null}

      {shownTab === "classifica" ? (
        <Classifica
          board={board}
          setBoard={setBoard}
          query={boardQuery}
          setQuery={setBoardQuery}
          roundLive={roundLive}
          liveReady={hub.liveReady}
          standings={hub.standings}
          partial={hub.partial}
          liveRows={hub.liveStandings}
          mineId={mineId}
          week={selected?.number ?? hub.home.gameweekNumber}
          showEntry={hub.league.isManager || hub.league.platformOverride}
          waiting={hub.home.lastRoundNumber == null && hub.standings.every((row) => row.played === 0 && row.points === 0)}
          onLineup={() => setTab("formazione")}
        />
      ) : null}

      {shownTab === "regolamento" ? <RegulationPanel leagueId={hub.league.id} /> : null}

      {shownTab === "lega" ? (
        hub.league.isManager ? (
          <LeagueAdminPanel
            key={`${hub.league.id}-${hub.league.joinCode}-${hub.league.rules.format}-${hub.league.delegates.map((delegate) => delegate.userId).join(",")}`}
            league={hub.league}
            pending={pending}
            onSave={saveLeagueAdmin}
            onRemove={remove}
            onGrant={grantDelegate}
            onRevoke={revokeDelegate}
          />
        ) : <LeagueRulesReadout league={hub.league} />
      ) : null}
      {armOpen && canEdit ? (
        <WheelPicker
          title={armOpen === "captain" ? "Capitano" : "Vice"}
          items={[...fielded]
            .filter((player) => armOpen === "captain" || player.id !== captainId)
            .sort((left, right) => BENCH_ROLES.indexOf(left.role) - BENCH_ROLES.indexOf(right.role))
            .map((player) => ({ id: player.id, label: player.fullName, role: player.role, detail: player.clubShort }))}
          selectedId={armOpen === "captain" ? captainId : viceId}
          onClose={() => setArmOpen(null)}
          onConfirm={(playerId) => {
            mark(playerId, armOpen);
            setArmOpen(null);
          }}
        />
      ) : null}
      {replacing ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setReplacingId(null)}>
          <div className="modal" role="dialog" aria-label={`Sostituisci ${replacing.fullName}`} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>Sostituisci {replacing.fullName}</h2>
              <button className="ghost" type="button" onClick={() => setReplacingId(null)}>Chiudi</button>
            </div>
            <p className="small muted">
              {ROLE_LABEL[replacing.role]} non in campo. Chi entra e chi esce si scambiano di posto.
            </p>
            {replacementPlayers.length === 0 ? <p>Nessun calciatore libero in questo ruolo.</p> : (
              <div className="stack">
                {replacementPlayers.map((player) => (
                  <button
                    className="bench-player"
                    key={player.id}
                    type="button"
                    data-busy={picks.busyId === player.id}
                    disabled={pending || (picks.locked && picks.busyId !== player.id)}
                    aria-busy={picks.busyId === player.id}
                    onClick={() => replaceStarter(player)}
                  >
                    <strong>{player.fullName}<AvailabilityBadge player={player} /></strong>
                    <span>
                      {picks.busyId === player.id ? "Sostituisco..." : <><TeamBadge teamName={player.clubShort} /> {player.clubShort}</>}
                      {picks.busyId === player.id ? "" : benchIds.includes(player.id) ? " · in panchina" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {pickerRole ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPickerRole(null)}>
          <div className="modal" role="dialog" aria-label={ROLE_LABEL[pickerRole]} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>{ROLE_LABEL[pickerRole]}</h2>
              <button className="ghost" type="button" onClick={() => setPickerRole(null)}>Chiudi</button>
            </div>
            <p className="small muted">Scegli chi schierare in questo posto del modulo.</p>
            {pickerPlayers.length === 0 ? <p>Nessun calciatore libero in questo ruolo.</p> : (
              <div className="stack">
                {pickerPlayers.map((player) => (
                  <button
                    className="bench-player"
                    key={player.id}
                    type="button"
                    data-busy={picks.busyId === player.id}
                    disabled={pending || (picks.locked && picks.busyId !== player.id)}
                    aria-busy={picks.busyId === player.id}
                    onClick={() => place(player)}
                  >
                    <strong>{player.fullName}<AvailabilityBadge player={player} /></strong>
                    <span>
                      {picks.busyId === player.id ? "Schiero..." : <><TeamBadge teamName={player.clubShort} /> {player.clubShort}</>}
                      {picks.busyId === player.id ? "" : benchIds.includes(player.id) ? " · in panchina" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Formations({
  opponents,
  revealed,
  gameweekNumber,
  carried,
}: {
  opponents: OpponentLineup[];
  revealed: boolean;
  gameweekNumber: number | null;
  carried: { from: number; pick: LeagueHubData["lineup"]; roster: CatalogPlayer[] } | null;
}) {
  return (
    <section className="stack">
      <p className="small muted">
        {revealed
          ? `Giornata ${gameweekNumber ?? "—"}: formazioni schierate, in campo e in panchina.`
          : "La tua formazione salvata è qui. Quelle degli altri si aprono all'inizio della giornata, quando la deadline è passata."}
      </p>
      {opponents.length === 0 ? (
        <EmptyState title="Nessuna squadra">
          Non c&apos;è ancora nessuno in questa lega. Invita con il codice dalla scheda Lega, poi le formazioni compaiono qui.
        </EmptyState>
      ) : (
        <div className="formation-board">
          {opponents.map((opponent) => (
            <FormationCard key={opponent.fantasyTeamId} opponent={opponent} carried={opponent.isMine ? carried : null} />
          ))}
        </div>
      )}
    </section>
  );
}

function FormationCard({
  opponent,
  carried,
}: {
  opponent: OpponentLineup;
  carried: { from: number; pick: LeagueHubData["lineup"]; roster: CatalogPlayer[] } | null;
}) {
  const savedPlayers = opponent.slots.map((slot) => ({
    id: slot.playerId,
    fullName: slot.fullName,
    role: slot.role,
    clubShort: slot.clubShort,
  }));
  const carriedPlayers = carried
    ? carried.pick.playerIds
      .map((playerId) => carried.roster.find((player) => player.id === playerId))
      .filter((player): player is CatalogPlayer => Boolean(player))
      .map((player) => ({
        id: player.id,
        fullName: player.fullName,
        role: player.role,
        clubShort: player.clubShort,
      }))
    : [];
  const useCarried = !opponent.filed && carriedPlayers.length > 0;
  const players = useCarried ? carriedPlayers : savedPlayers;
  const playerIds = players.map((player) => player.id);
  const formation = inferFormation(countRoles(players, playerIds));
  const captainId = useCarried
    ? carried?.pick.captainId ?? null
    : opponent.slots.find((slot) => slot.isCaptain)?.playerId ?? null;
  const viceId = useCarried
    ? carried?.pick.viceId ?? null
    : opponent.slots.find((slot) => slot.isVice)?.playerId ?? null;
  const bench = useCarried
    ? (carried?.pick.benchIds ?? [])
      .map((playerId) => carried?.roster.find((player) => player.id === playerId))
      .filter((player): player is CatalogPlayer => Boolean(player))
      .map((player) => ({ id: player.id, fullName: player.fullName, role: player.role, clubShort: player.clubShort }))
    : opponent.bench.map((player) => ({
      id: player.playerId,
      fullName: player.fullName,
      role: player.role,
      clubShort: player.clubShort,
    }));
  return (
    <article className="panel formation-card">
      <h2>{opponent.teamName}</h2>
      <p className="small muted">{[opponent.displayName, opponent.isMine ? "la tua" : ""].filter(Boolean).join(" · ")}</p>
      {useCarried ? (
        <p className="small muted">Ultima formazione salvata, giornata {carried?.from}. Non ancora confermata per questa giornata.</p>
      ) : null}
      {opponent.office ? <p className="small muted">Formazione d&apos;ufficio: non salvata in tempo.</p> : null}
      {!opponent.filed && !useCarried ? <p>Non schierata.</p> : !opponent.revealed && !useCarried ? (
        <p>Schierata. I nomi si vedono all&apos;inizio della giornata.</p>
      ) : (
        <>
          <Pitch
            compact
            formation={formation}
            players={players}
            playerIds={playerIds}
            captainId={captainId}
            viceId={viceId}
            editable={false}
          />
          {bench.length === 0 ? <p className="small muted">Panchina vuota.</p> : (
            <ol className="bench-order">
              {bench.map((player, index) => (
                <li key={player.id}>
                  {index + 1}. <TeamBadge teamName={player.clubShort} /> {player.fullName}
                  <span className="small muted"> · {ROLE_LABEL[player.role]} · {player.clubShort}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </article>
  );
}

function GameweekBar({
  gameweeks,
  selectedId,
  pending,
  onSelect,
}: {
  gameweeks: LeagueHubData["gameweeks"];
  selectedId: string | null;
  pending: boolean;
  onSelect: (gameweekId: string) => void;
}) {
  if (gameweeks.length === 0) {
    return <p className="card">Nessuna giornata in questo range. Genera il calendario con calendar_setup.sql.</p>;
  }
  return (
    <div className="gw-row">
      {gameweeks.map((gameweek) => (
        <button
          key={gameweek.id}
          className="gw-chip"
          type="button"
          data-active={gameweek.id === selectedId}
          data-next={gameweek.isNext}
          data-locked={gameweek.locked}
          disabled={pending}
          onClick={() => onSelect(gameweek.id)}
        >
          {gameweek.number}
        </button>
      ))}
    </div>
  );
}

function Squads({ squads }: { squads: LeagueHubData["squads"] }) {
  if (squads.length === 0) {
    return (
      <EmptyState title="Nessuna squadra">
        Non c&apos;è ancora nessuno in questa lega. Invita con il codice dalla scheda Lega.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      {squads.map((squad) => (
        <article className="card" key={squad.fantasyTeamId}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{squad.teamName}{squad.isMine ? " · la tua" : ""}</h2>
            {squad.isMine ? <Link className="ghost" href="/rosa">Cambia la mia rosa</Link> : null}
          </div>
          <p className="small muted">{[squad.displayName, `${squad.players.length} calciatori`].filter(Boolean).join(" · ")}</p>
          {squad.players.length === 0 ? (
            <EmptyState
              title="Rosa ancora vuota"
              action={squad.isMine ? <Link className="primary" href="/rosa">Componi la rosa</Link> : undefined}
            >
              {squad.isMine
                ? "Apri un club e scegli un calciatore. Vale un giocatore per club, poi salva."
                : "Il proprietario non ha ancora salvato la rosa di questa giornata."}
            </EmptyState>
          ) : (
            <div className="squad-list">
              {squad.players.map((player) => (
                <article className="person-card" key={player.id}>
                  <strong>{player.fullName}</strong>
                  <div className="person-card-meta">
                    <span className={`badge ${player.role}`}>{ROLE_LABEL[player.role]}</span>
                    <span className="small"><TeamBadge teamName={player.clubShort} /> {player.clubShort}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function liveRows(rows: LiveLineupSheet["starters"]): CompactPlayer[] {
  return rows.map((row) => ({
    id: row.playerId,
    name: row.fullName,
    role: row.role,
    club: row.clubShort,
    vote: row.voto,
    fanta: row.fantavoto,
    captain: row.isCaptain,
    played: row.voto != null,
    entered: false,
    events: [],
  }));
}

function PlayedLineup({ sheet }: { sheet: LiveLineupSheet }) {
  return (
    <div className="stack">
      <section className="panel">
        <h2>Giocatori in campo</h2>
        <CompactLineup starters={liveRows(sheet.starters)} bench={liveRows(sheet.bench)} empty="—" />
      </section>
      {sheet.penalty != null ? (
        <p className="small">In questa lega chi non salva la formazione prende la penalità: {formatPoints(sheet.penalty)} punti.</p>
      ) : null}
      <p className="small muted">
        Proiezione {formatPoints(sheet.partialTotal)}
        <InfoTip label="Proiezione">Somma dei fantavoti già pubblicati. La panchina entra solo se il titolare è senza voto. Difesa, bonus capitano e classifica ufficiale restano al calcolo dei 130 minuti.</InfoTip>
      </p>
    </div>
  );
}

function namedMatch(query: string, name: string, displayName: string) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return name.toLowerCase().includes(text) || displayName.toLowerCase().includes(text);
}

function MinePin({ rank, name, detail, points }: { rank: string; name: string; detail: string; points: string }) {
  return (
    <p className="mine-pin">
      <span>{rank}</span>
      <strong>{name}</strong>
      <small>{detail}</small>
      <b>{points}</b>
    </p>
  );
}

function Classifica({
  board,
  setBoard,
  query,
  setQuery,
  roundLive,
  liveReady,
  standings,
  partial,
  liveRows,
  mineId,
  week,
  showEntry,
  waiting,
  onLineup,
}: {
  board: "parziale" | "generale" | "live";
  setBoard: (board: "parziale" | "generale" | "live") => void;
  query: string;
  setQuery: (query: string) => void;
  roundLive: boolean;
  liveReady: boolean;
  standings: LeagueHubData["standings"];
  partial: LeagueHubData["partial"];
  liveRows: LeagueHubData["liveStandings"];
  mineId: string | null;
  week: number | null;
  showEntry: boolean;
  waiting: boolean;
  onLineup: () => void;
}) {
  const standingsView = standings.filter((row) => namedMatch(query, row.teamName, row.displayName));
  const partialView = partial.filter((row) => namedMatch(query, row.teamName, row.displayName));
  const liveView = liveRows.filter((row) => namedMatch(query, row.teamName, row.displayName));
  return (
    <section className="card board-card">
      <div className="board-tools">
        <div className="tabs" role="tablist" aria-label="Tipo di classifica">
          <button className="tab" type="button" data-active={board === "generale"} onClick={() => setBoard("generale")}>Generale</button>
          <button className="tab" type="button" data-active={board === "parziale"} onClick={() => setBoard("parziale")}>Giornata{week ? ` ${week}` : ""}</button>
          {roundLive ? <button className="tab" type="button" data-active={board === "live"} onClick={() => setBoard("live")}>Live</button> : null}
        </div>
        <input aria-label="Cerca squadra o partecipante" placeholder="Cerca squadra" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {board === "live" && roundLive && !liveReady ? <p className="banner">Classifica live non disponibile.</p> : null}
      {board === "parziale" ? (
        partial.length === 0 ? <EmptyState title="Giornata vuota">Nessuna squadra iscritta.</EmptyState>
          : <PartialTable rows={partialView} source={partial} mineId={mineId} />
      ) : null}
      {board === "live" && roundLive ? <LiveTable rows={liveView} source={liveRows} mineId={mineId} /> : null}
      {board === "generale" || (board === "live" && !roundLive) ? (
        standings.length === 0 ? <EmptyState title="Classifica vuota">Nessuna squadra iscritta.</EmptyState>
          : waiting ? <EmptyState title="In attesa della giornata 1" action={<button className="primary" type="button" onClick={onLineup}>Apri la formazione</button>}>I punti partono dopo la prima giornata calcolata.</EmptyState>
            : <StandingBoard rows={standingsView} source={standings} mineId={mineId} showEntry={showEntry} />
      ) : null}
    </section>
  );
}

function StandingBoard({
  rows,
  source,
  mineId,
  showEntry,
}: {
  rows: LeagueHubData["standings"];
  source: LeagueHubData["standings"];
  mineId: string | null;
  showEntry: boolean;
}) {
  const leader = source.reduce((max, row) => Math.max(max, row.points), 0);
  const mine = source.find((row) => row.fantasyTeamId === mineId) ?? null;
  return (
    <>
      {mine ? <MinePin rank={`${mine.rank}°`} name={mine.teamName} detail={mine.displayName} points={formatPoints(mine.points)} /> : null}
      <div className="board-scroll">
        <table className="standings board">
          <thead>
            <tr>
              <th className="pin">Pos</th>
              <th className="pin pin-team">Squadra</th>
              <th>PT</th>
              <th>G</th>
              <th>Media</th>
              <th>Top</th>
              <th>Diff</th>
              <th>Grezzi</th>
              {showEntry ? <th>Ingresso</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td className="pin" colSpan={showEntry ? 9 : 8}>Nessuna squadra con questo nome.</td></tr> : rows.map((row) => (
              <tr key={row.fantasyTeamId} data-mine={row.fantasyTeamId === mineId}>
                <td className="pin">{row.rank}</td>
                <td className="pin pin-team">
                  <strong>{row.teamName}</strong>
                  <span>{row.displayName}</span>
                </td>
                <td className="board-pt">{formatPoints(row.points)}</td>
                <td>{row.played}</td>
                <td>{row.played > 0 ? formatPoints(row.points / row.played) : "—"}</td>
                <td>{row.best == null ? "—" : formatPoints(row.best)}</td>
                <td>{formatPoints(row.points - leader)}</td>
                <td>{formatPoints(row.realPoints)}</td>
                {showEntry ? <td>{formatPoints(row.entryPoints)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="board-legend">
        <InfoTip label="Colonne classifica">PT è il punteggio in classifica. G sono le giornate disputate. Media è PT diviso G. Top è il miglior punteggio di giornata. Diff è lo scarto dal primo. Grezzi sono i punti senza l&apos;ingresso di chi parte dopo.{showEntry ? " Ingresso si vede solo all'admin di lega." : ""}</InfoTip>
      </p>
    </>
  );
}

function LiveTable({ rows, source, mineId }: { rows: LeagueHubData["liveStandings"]; source: LeagueHubData["liveStandings"]; mineId: string | null }) {
  const mine = source.find((row) => row.fantasyTeamId === mineId) ?? null;
  return (
    <>
      {mine ? <MinePin rank={`${mine.rank}°`} name={mine.teamName} detail={mine.displayName} points={formatPoints(mine.points)} /> : null}
      <div className="board-scroll">
        <table className="standings board">
          <thead>
            <tr>
              <th className="pin">Pos</th>
              <th className="pin pin-team">Squadra</th>
              <th>PT</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="pin" colSpan={3}>Nessuna squadra con questo nome.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.fantasyTeamId} data-mine={row.fantasyTeamId === mineId}>
                <td className="pin">{row.rank}</td>
                <td className="pin pin-team">
                  <strong>{row.teamName}</strong>
                  <span>{row.ratedPlayers !== null ? `${row.ratedPlayers}/11 con voto` : row.displayName}</span>
                </td>
                <td className="board-pt">{formatPoints(row.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PartialTable({ rows, source, mineId }: { rows: LeagueHubData["partial"]; source: LeagueHubData["partial"]; mineId: string | null }) {
  const mine = source.find((row) => row.fantasyTeamId === mineId) ?? null;
  return (
    <>
      {mine ? <MinePin rank={mine.rank ? `${mine.rank}°` : "–"} name={mine.teamName} detail={mine.office ? "D'ufficio" : mine.filed ? "Schierata" : "Non schierata"} points={mine.points === null ? "—" : formatPoints(mine.points)} /> : null}
      <div className="board-scroll">
        <table className="standings board">
          <thead>
            <tr>
              <th className="pin">Pos</th>
              <th className="pin pin-team">Squadra</th>
              <th>PG</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td className="pin" colSpan={3}>Nessuna squadra con questo nome.</td></tr> : rows.map((row) => (
              <tr key={row.fantasyTeamId} data-mine={row.fantasyTeamId === mineId}>
                <td className="pin">{row.rank || "—"}</td>
                <td className="pin pin-team">
                  <strong>{row.teamName}</strong>
                  <span>{row.office ? "D'ufficio" : row.filed ? "Schierata" : "Non schierata"}</span>
                </td>
                <td className="board-pt">{row.points === null ? "—" : formatPoints(row.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="board-legend"><InfoTip label="Classifica di giornata">PG è il punteggio di questa giornata. Prima del calcolo resta un trattino.</InfoTip></p>
    </>
  );
}
