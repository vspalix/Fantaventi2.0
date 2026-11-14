"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CopyInviteLink } from "@/components/leagues/CopyInviteLink";
import { LeagueAdminPanel } from "@/components/leagues/LeagueAdminPanel";
import { LeagueBoard } from "@/components/leagues/LeagueBoard";
import { MatchCenter } from "@/components/leagues/MatchCenter";
import { MatchdayResults } from "@/components/leagues/MatchdayResults";
import { Pitch } from "@/components/leagues/Pitch";
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
import type { LeagueRules } from "@/lib/league-rules";
import type { CatalogPlayer, LeagueDetail, LeagueHubData, LiveLineupSheet, OpponentLineup, PlayerRole } from "@/lib/types";
import { RegulationPanel } from "@/components/rules/RegulationView";
import { ROLE_LABEL } from "@/lib/types";

const BENCH_ROLES: PlayerRole[] = ["GK", "DEF", "MID", "FWD"];
const ROLE_SHORT: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };
const deadlineFormat = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Richiesta non riuscita.");
  return body;
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function formatPoints(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MATCH_STATUS: Record<string, string> = {
  scheduled: "In programma",
  locked: "Bloccata",
  live: "Live",
  finished: "Finita",
};

function LeagueHomeView({
  home,
  standings,
  mineId,
  onLineup,
}: {
  home: LeagueHubData["home"];
  standings: LeagueHubData["standings"];
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
            <p className="small muted">
              La formazione si apre per consultarla. Il countdown della prossima giornata parte quando questa è finita.
              {" "}
              {savedLine(home.lineupSaved, home.lineupSavedAt)}
            </p>
            <button className="primary" type="button" onClick={onLineup}>Apri la formazione</button>
          </div>
        ) : (
          <>
            <h2>Nessuna giornata aperta</h2>
            <p className="small muted">Il calendario di questa lega non ha una giornata ancora da preparare.</p>
          </>
        )}
      </article>
      <article className="card">
        <h2>Ultima giornata{home.lastRoundNumber ? ` · ${home.lastRoundNumber}` : ""}</h2>
        {home.lastRoundNumber ? (
          <MiniTable rows={home.lastRound} mineId={mineId} empty="Nessun punteggio pubblicato." />
        ) : (
          <p className="small muted">Nessuna giornata chiusa.</p>
        )}
      </article>
      <article className="card">
        <h2>Classifica generale</h2>
        <MiniTable rows={standings} mineId={mineId} empty="Nessuna squadra iscritta." />
      </article>
      <article className="card home-span">
        <h2>
          Partite di {home.competitionName}
          {home.fixtureGameweekNumber ? ` · giornata ${home.fixtureGameweekNumber}` : ""}
        </h2>
        {home.fixtures.length === 0 ? <p className="small muted">Nessuna partita in calendario per questa giornata.</p> : (
          <div className="fixture-list">
            {home.fixtures.map((fixture) => {
              const scored = fixture.homeGoals != null && fixture.awayGoals != null;
              return (
                <p className="fixture-row" key={fixture.id}>
                  <strong>
                    {scored
                      ? `${fixture.home} ${fixture.homeGoals} – ${fixture.awayGoals} ${fixture.away}`
                      : `${fixture.home} – ${fixture.away}`}
                  </strong>
                  <span className="small muted">
                    {scored ? null : (
                      <>
                        {deadlineFormat.format(new Date(fixture.kickoffAt))}
                        {" · "}
                      </>
                    )}
                    {MATCH_STATUS[fixture.status] ?? fixture.status}
                  </span>
                </p>
              );
            })}
          </div>
        )}
      </article>
    </section>
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
        <p className="small muted">Il countdown della prossima giornata parte quando questa è finita.</p>
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
              <span className="small muted"> · {row.displayName}</span>
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
}: {
  initial: LeagueHubData;
  allowTestFill?: boolean;
  hostMode?: boolean;
}) {
  const [hub, setHub] = useState(initial);
  const [tab, setTab] = useState<"home" | "live" | "bacheca" | "squadre" | "formazione" | "formazioni" | "classifica" | "risultati" | "regolamento" | "lega" | "gestione">("home");
  const shownTab = tab === "gestione" && !(hostMode && hub.league.isManager) ? "home" : tab;
  const [board, setBoard] = useState<"parziale" | "generale" | "live">("generale");
  const [playerIds, setPlayerIds] = useState(initial.lineup.playerIds);
  const [benchIds, setBenchIds] = useState(initial.lineup.benchIds);
  const [pickerRole, setPickerRole] = useState<PlayerRole | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [formationId, setFormationId] = useState<FormationId>(
    inferFormation(countRoles(initial.roster, initial.lineup.playerIds)).id,
  );
  const [captainId, setCaptainId] = useState(initial.lineup.captainId);
  const [viceId, setViceId] = useState(initial.lineup.viceId);
  const [name, setName] = useState(initial.league.name);
  const [startMatchday, setStartMatchday] = useState(initial.league.startMatchday);
  const [endMatchday, setEndMatchday] = useState(initial.league.endMatchday);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const selected = hub.gameweeks.find((gameweek) => gameweek.id === hub.selectedGameweekId) ?? null;
  const next = hub.gameweeks.find((gameweek) => gameweek.isNext) ?? null;
  const countdownOpen = hub.home.phase === "countdown"
    && Boolean(hub.home.deadlineAt)
    && new Date(hub.home.deadlineAt ?? 0).getTime() > now;
  const canEdit = hub.editable && countdownOpen;

  useEffect(() => {
    if (hub.home.phase !== "countdown") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hub.home.phase, hub.home.deadlineAt]);

  function applyHub(nextHub: LeagueHubData) {
    setHub(nextHub);
    setPlayerIds(nextHub.lineup.playerIds);
    setBenchIds(nextHub.lineup.benchIds);
    setPickerRole(null);
    setReplacingId(null);
    setFormationId(inferFormation(countRoles(nextHub.roster, nextHub.lineup.playerIds)).id);
    setCaptainId(nextHub.lineup.captainId);
    setViceId(nextHub.lineup.viceId);
    setName(nextHub.league.name);
    setStartMatchday(nextHub.league.startMatchday);
    setEndMatchday(nextHub.league.endMatchday);
  }

  async function openGameweek(gameweekId: string) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const body = await readJson<{ hub: LeagueHubData }>(
        await fetch(`/api/leagues/${hub.league.id}/hub?gameweek=${gameweekId}`),
      );
      applyHub(body.hub);
      setTab((current) => current === "formazioni" ? current : "formazione");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Giornata non disponibile.");
    } finally {
      setPending(false);
    }
  }

  function chooseFormation(nextId: FormationId) {
    if (!canEdit) return;
    const nextIds = trimToFormation(hub.roster, playerIds, formationById(nextId));
    setFormationId(nextId);
    setPlayerIds(nextIds);
    setBenchIds(benchIds.filter((id) => !nextIds.includes(id)));
    if (captainId && !nextIds.includes(captainId)) setCaptainId(null);
    if (viceId && !nextIds.includes(viceId)) setViceId(null);
  }

  function place(player: CatalogPlayer) {
    if (!canEdit || playerIds.includes(player.id)) return;
    const formation = formationById(formationId);
    const used = hub.roster.filter((item) => playerIds.includes(item.id) && item.role === player.role).length;
    if (used >= roleCap(formation, player.role) || playerIds.length >= 11) return;
    setPlayerIds([...playerIds, player.id]);
    setBenchIds(benchIds.filter((id) => id !== player.id));
    setPickerRole(null);
    setReplacingId(null);
  }

  function replaceStarter(incoming: CatalogPlayer) {
    if (!canEdit || !replacingId || incoming.id === replacingId) return;
    const outgoing = hub.roster.find((player) => player.id === replacingId);
    if (!outgoing || incoming.role !== outgoing.role || !playerIds.includes(replacingId)) return;
    setPlayerIds(playerIds.map((id) => (id === replacingId ? incoming.id : id)));
    setBenchIds(benchIds.filter((id) => id !== incoming.id));
    if (captainId === replacingId) setCaptainId(null);
    if (viceId === replacingId) setViceId(null);
    setReplacingId(null);
  }

  function addToBench(player: CatalogPlayer) {
    if (!canEdit || playerIds.includes(player.id) || benchIds.includes(player.id)) return;
    setBenchIds([...benchIds, player.id]);
  }

  function dropFromBench(playerId: string) {
    if (!canEdit) return;
    setBenchIds(benchIds.filter((id) => id !== playerId));
  }

  function clearPitch() {
    if (!canEdit || pending) return;
    setPlayerIds([]);
    setBenchIds([]);
    setCaptainId(null);
    setViceId(null);
    setPickerRole(null);
    setReplacingId(null);
    setError(null);
    setMessage("Campo svuotato. L'ultima formazione salvata resta: la ritrovi nel tab Formazioni e riapre la giornata successiva.");
  }

  function mark(playerId: string, kind: "captain" | "vice") {
    if (!canEdit || !playerIds.includes(playerId)) return;
    if (kind === "captain") {
      setCaptainId(playerId);
      if (viceId === playerId) setViceId(null);
      return;
    }
    if (playerId === captainId) return;
    setViceId(playerId);
  }

  async function fileTestLineup() {
    if (!selected || !canEdit || !allowTestFill) return;
    const picked = autoLineup(hub.roster);
    if (!picked) {
      window.alert("In rosa non c'è un modulo valido da schierare.");
      return;
    }
    const issue = formationIssue(hub.roster, picked.playerIds);
    if (issue) {
      window.alert(issue);
      return;
    }
    setFormationId(picked.formationId);
    setPlayerIds(picked.playerIds);
    setBenchIds(picked.benchIds);
    setCaptainId(picked.captainId);
    setViceId(picked.viceId);
    setPickerRole(null);
    setReplacingId(null);
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const body = await readJson<{ hub: LeagueHubData }>(await fetch(`/api/leagues/${hub.league.id}/lineup`, {
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
      applyHub(body.hub);
      setMessage("Formazione di test schierata e salvata.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Schieramento di test non riuscito.");
    } finally {
      setPending(false);
    }
  }

  async function saveLineup() {
    if (!selected || !canEdit) return;
    if (saveBlocked) {
      window.alert(`Non posso salvare perché ${saveReason}.`);
      return;
    }
    if (shapeIssue) {
      window.alert(shapeIssue);
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const body = await readJson<{ hub: LeagueHubData }>(await fetch(`/api/leagues/${hub.league.id}/lineup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameweekId: selected.id, playerIds, benchIds, captainId, viceId }),
      }));
      applyHub(body.hub);
      setMessage("Formazione salvata.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setPending(false);
    }
  }

  async function saveLeagueAdmin(input: {
    name: string;
    startMatchday: number;
    endMatchday: number;
    regenerateCode?: boolean;
    rules: LeagueRules;
  }) {
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
      setName(input.name);
      setStartMatchday(input.startMatchday);
      setEndMatchday(input.endMatchday);
      setMessage(input.regenerateCode ? "Nuovo codice invito generato." : "Impostazioni della lega salvate.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setPending(false);
    }
  }

  async function saveLeague(regenerateCode = false) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await readJson<{ league: LeagueDetail }>(await fetch(`/api/leagues/${hub.league.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, regenerateCode, startMatchday, endMatchday }),
      }));
      const body = await readJson<{ hub: LeagueHubData }>(await fetch(`/api/leagues/${hub.league.id}/hub`));
      applyHub(body.hub);
      setMessage(regenerateCode ? "Nuovo codice invito generato." : "Impostazioni salvate.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
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
      setError(reason instanceof Error ? reason.message : "Nomina non riuscita.");
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
      setError(reason instanceof Error ? reason.message : "Revoca non riuscita.");
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
      setError(reason instanceof Error ? reason.message : "Rimozione non riuscita.");
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
  const available = hub.roster.filter((player) => !playerIds.includes(player.id) && !benchIds.includes(player.id));
  const missingBench = available.length > 0;
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
  const showingStoredLineup = sameIds(playerIds, hub.lineup.playerIds) && sameIds(benchIds, hub.lineup.benchIds);

  return (
    <div className="stack">
      <header>
        <p className="small muted">
          {hub.league.seasonCode} · Giornate {hub.league.startMatchday}–{hub.league.endMatchday}
          {" · "}
          {hub.league.rules.format === "h2h" ? "Scontri diretti" : hub.league.rules.format === "hybrid" ? "Fasi" : "Somma punti"}
          {" · "}
          {hub.league.rules.visibility === "public" ? "Pubblica" : "Privata"}
          {" · "}
          {hub.league.rules.defenseEnabled ? "Modificatore difesa" : "Senza modificatore difesa"}
          {hostMode ? ` · ${hub.league.isOwner ? "Admin di lega" : hub.league.isManager ? "Admin delegato" : "Partecipante"}` : ""}
        </p>
        <div className="row page-head">
          <h1 className="section-title">{hub.league.name}</h1>
          <Link className="primary" href="/rosa">Cambia la mia rosa</Link>
        </div>
      </header>
      {hostMode && hub.league.platformOverride ? (
        <p className="banner">Stai dentro questa lega come super admin. Puoi cambiare regole e admin. Il laboratorio voti resta la correzione dei tabellini di stagione.</p>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      {message ? <p className="banner ok">{message}</p> : null}
      <div className="tabs scroll-tabs" role="tablist" aria-label="Sezioni della lega">
        <button className="tab" type="button" data-active={shownTab === "home"} onClick={() => setTab("home")}>Home</button>
        <button className="tab" type="button" data-active={shownTab === "live"} onClick={() => setTab("live")}>Live</button>
        <button className="tab" type="button" data-active={shownTab === "bacheca"} onClick={() => setTab("bacheca")}>Bacheca</button>
        <button className="tab" type="button" data-active={shownTab === "squadre"} onClick={() => setTab("squadre")}>Squadre</button>
        <button className="tab" type="button" data-active={shownTab === "formazione"} onClick={() => setTab("formazione")}>Formazione</button>
        <button className="tab" type="button" data-active={shownTab === "formazioni"} onClick={() => setTab("formazioni")}>Formazioni</button>
        <button className="tab" type="button" data-active={shownTab === "classifica"} onClick={() => setTab("classifica")}>Classifica</button>
        <button className="tab" type="button" data-active={shownTab === "risultati"} onClick={() => setTab("risultati")}>Risultati</button>
        <button className="tab" type="button" data-active={shownTab === "regolamento"} onClick={() => setTab("regolamento")}>Regolamento</button>
        <button className="tab" type="button" data-active={shownTab === "lega"} onClick={() => setTab("lega")}>Lega</button>
        {hostMode && hub.league.isManager ? (
          <button className="tab" type="button" data-active={shownTab === "gestione"} onClick={() => setTab("gestione")}>Gestione</button>
        ) : null}
      </div>

      {tab !== "lega" && tab !== "home" && tab !== "regolamento" && tab !== "risultati" && tab !== "gestione" ? (
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
            <p className="small muted">Rose valide alla giornata {selected.number}. Portieri, difensori, centrocampisti, attaccanti.</p>
          ) : null}
          <Squads squads={hub.squads} />
        </section>
      ) : null}

      {shownTab === "formazione" ? (
        <section className="stack">
          {selected ? (
            <p className="small muted">
              Giornata {selected.number}
              {canEdit ? ` · deadline ${deadlineFormat.format(new Date(selected.deadlineAt))} · unica giornata modificabile` : " · consultazione"}
            </p>
          ) : null}
          {selected && !canEdit ? (
            <p className="banner">
              {hub.liveSheet
                ? `Giornata ${selected.number} in corso. Il fantavoto è voto + bonus + malus, appena il voto è pubblicato.`
                : hub.home.phase === "live" || (hub.home.phase === "countdown" && !countdownOpen)
                  ? `Giornata ${hub.home.gameweekNumber ?? selected.number} in corso. La formazione si consulta. Il countdown della prossima parte a giornata finita.`
                  : hub.home.phase === "countdown" && next
                    ? `Questa giornata si consulta. La giornata ${next.number} è quella del countdown: lì si modifica la formazione.`
                    : "Questa giornata è chiusa. La formazione resta in consultazione."}
            </p>
          ) : null}

          {hub.liveSheet ? <PlayedLineup sheet={hub.liveSheet} /> : null}
          {hub.liveSheet ? null : <div className="lineup-layout">
            <section className="panel roster-main">
              <div className="roster-main-head">
                <h2>La tua formazione</h2>
                {canEdit ? (
                  <span className="lineup-actions">
                    {allowTestFill ? (
                      <button
                        className="ghost"
                        type="button"
                        disabled={pending || hub.roster.length === 0}
                        onClick={() => void fileTestLineup()}
                      >
                        Schiera di test
                      </button>
                    ) : null}
                    <button
                      className="ghost"
                      type="button"
                      disabled={pending || (playerIds.length === 0 && benchIds.length === 0)}
                      onClick={clearPitch}
                    >
                      Svuota campo
                    </button>
                    <span
                      className="save-lineup"
                      data-blocked={saveBlocked}
                      onClick={() => {
                        if (!pending && saveBlocked) {
                          window.alert(`Non posso salvare perché ${saveReason}.`);
                        }
                      }}
                    >
                      <button
                        className="primary"
                        type="button"
                        disabled={pending || saveBlocked}
                        onClick={() => void saveLineup()}
                      >
                        {pending ? "Salvataggio..." : "Salva formazione"}
                      </button>
                    </span>
                  </span>
                ) : null}
              </div>
              {hub.lineupOrigin === "saved" && showingStoredLineup && playerIds.length > 0 ? (
                <p className="small muted">La formazione salvata per questa giornata è già in campo.</p>
              ) : null}
              {hub.lineupOrigin === "previous" && hub.carriedFromMatchday && showingStoredLineup ? (
                <p className="small muted">
                  In campo c&apos;è l&apos;ultima formazione salvata, giornata {hub.carriedFromMatchday}. Salvala per confermarla su questa giornata.
                </p>
              ) : null}
              {canEdit && saveBlocked ? (
                <p className="banner">
                  Non puoi salvare: {saveReason}.
                  {missingCaptainOrVice ? " Scegli capitano e vice sui titolari, con C e V." : ""}
                  {missingBench ? " Clicca i calciatori rimasti: l'ordine dei clic è la panchina." : ""}
                </p>
              ) : null}
              {canEdit ? (
                <div className="tabs" role="tablist" aria-label="Modulo">
                  {FORMATIONS.map((item) => (
                    <button
                      key={item.id}
                      className="tab"
                      type="button"
                      data-active={item.id === formationId}
                      disabled={pending}
                      onClick={() => chooseFormation(item.id)}
                    >
                      {item.id}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="small muted">
                {canEdit
                  ? `${playerIds.length}/11 in campo. Un titolare apre la sostituzione. La lettera vuota schiera quel ruolo. Chi resta a destra entra in panchina nell'ordine dei clic.`
                  : `${playerIds.length}/11 in campo.`}
              </p>
              {shapeIssue ? <p className="small">{shapeIssue}</p> : null}
              {hub.roster.length === 0 ? <p>Nessun calciatore in rosa per questa giornata. Componi la rosa prima di schierare.</p> : (
                <Pitch
                  formation={formation}
                  players={hub.roster}
                  playerIds={playerIds}
                  captainId={captainId}
                  viceId={viceId}
                  editable={canEdit && !pending}
                  onReplace={setReplacingId}
                  onMark={mark}
                  onPickRole={setPickerRole}
                />
              )}
            </section>
            <aside className="panel roster-side">
              {canEdit ? (
                <div>
                  <h2>I tuoi giocatori</h2>
                  <p className="small muted">
                    In campo si schiera dal modulo. Qui restano gli altri: il clic li mette in panchina, nell&apos;ordine in cui li clicchi. Un secondo clic li toglie.
                  </p>
                  {bench.length === 0 ? <p className="small muted">Nessuno in panchina.</p> : (
                    <div className="side-list">
                      {bench.map((player, index) => (
                        <button
                          className="side-row"
                          key={player.id}
                          type="button"
                          data-selected="true"
                          disabled={pending}
                          onClick={() => dropFromBench(player.id)}
                        >
                          <strong>{index + 1}. {player.fullName}</strong>
                          <span className="small muted">{ROLE_LABEL[player.role]} · {player.clubShort}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {available.length === 0 ? <p className="small muted">Chi non è in campo è già in panchina.</p> : BENCH_ROLES.map((role) => {
                    const players = available.filter((player) => player.role === role);
                    if (players.length === 0) return null;
                    return (
                      <div key={`avail-${role}`}>
                        <p className="small">{ROLE_LABEL[role]}</p>
                        <div className="side-list">
                          {players.map((player) => (
                            <button
                              className="side-row"
                              key={player.id}
                              type="button"
                              disabled={pending}
                              onClick={() => addToBench(player)}
                            >
                              <strong>{player.fullName}</strong>
                              <span className="small muted">{ROLE_LABEL[player.role]} · {player.clubShort}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <h2>Panchina</h2>
                  {bench.length === 0 ? <p className="small muted">Panchina vuota.</p> : (
                    <ol className="bench-order">
                      {bench.map((player, index) => (
                        <li key={player.id}>
                          {index + 1}. {player.fullName}
                          <span className="small muted"> · {ROLE_LABEL[player.role]} · {player.clubShort}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </aside>
          </div>}
        </section>
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
        <MatchdayResults
          leagueId={hub.league.id}
          gameweeks={hub.gameweeks}
          teams={hub.league.participants}
          myTeamId={hub.opponents.find((team) => team.isMine)?.fantasyTeamId ?? hub.squads.find((team) => team.isMine)?.fantasyTeamId ?? null}
          canExport={hub.league.isManager}
        />
      ) : null}

      {shownTab === "classifica" ? (
        <section className="card">
          <div className="row">
            <h2>Classifica</h2>
            <div className="tabs" role="tablist">
              <button className="tab" type="button" data-active={board === "parziale"} onClick={() => setBoard("parziale")}>
                Parziale
              </button>
              <button className="tab" type="button" data-active={board === "generale"} onClick={() => setBoard("generale")}>
                Generale
              </button>
              <button className="tab" type="button" data-active={board === "live"} onClick={() => setBoard("live")}>
                Live
              </button>
            </div>
          </div>
          <p className="small muted">
            {board === "parziale"
              ? `Proiezione della giornata ${selected?.number ?? "—"}: somma dei fantavoti già pubblicati. Senza modificatore difesa e senza bonus capitano.`
              : board === "live"
                ? hub.home.phase === "live"
                  ? "La classifica generale più la proiezione di questa giornata. La generale ufficiale non si muove prima del calcolo dei 130 minuti."
                  : "Nessuna giornata in corso: questi sono gli stessi punti della generale."
                : hub.league.rules.format === "h2h"
                  ? "Ogni giornata è uno scontro. I fantapunti diventano gol con le soglie della lega: 3 punti alla vittoria, 1 al pareggio, 0 alla sconfitta."
                  : hub.league.rules.format === "hybrid"
                    ? "La regular season segue il formato della fase. Le giornate di coppa sono a eliminazione diretta e restano fuori da questa classifica."
                  : hub.league.rules.enrollment === "closed"
                    ? "Classifica a somma dei punti di giornata. La lega è a numero chiuso e non applica l'ingresso in media."
                    : `Chi parte da giornata ${hub.league.startMatchday} somma i punti reali delle giornate già chiuse. Chi entra dopo riceve, per ogni giornata saltata, la media dei punteggi di tutte le squadre nelle giornate precedenti.`}
          </p>
          {board === "live" && !hub.liveReady ? (
            <p className="banner">La classifica live chiede le colonne di production_architecture.sql.</p>
          ) : null}
          {board === "parziale" ? <PartialTable rows={hub.partial} /> : null}
          {board === "live" ? <LiveTable rows={hub.liveStandings} /> : null}
          {board === "generale" ? (
          <table className="standings as-cards">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Squadra</th>
                <th>Punti</th>
                <th>Reali</th>
                <th>Ingresso</th>
                <th>Disputate</th>
                <th>Saltate</th>
              </tr>
            </thead>
            <tbody>
              {hub.standings.length === 0 ? (
                <tr><td colSpan={7}>Nessuna squadra iscritta.</td></tr>
              ) : hub.standings.map((row) => (
                <tr key={row.fantasyTeamId}>
                  <td data-label="Pos">{row.rank}</td>
                  <td data-label="Squadra">
                    <strong>{row.teamName}</strong>
                    <span className="small muted"> · {row.displayName}</span>
                  </td>
                  <td data-label="Punti">{formatPoints(row.points)}</td>
                  <td data-label="Reali">{formatPoints(row.realPoints)}</td>
                  <td data-label="Ingresso">{formatPoints(row.entryPoints)}</td>
                  <td data-label="Disputate">{row.played}</td>
                  <td data-label="Saltate">{row.skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
          ) : null}
        </section>
      ) : null}

      {shownTab === "regolamento" ? <RegulationPanel leagueId={hub.league.id} /> : null}

      {shownTab === "gestione" && hostMode && hub.league.isManager ? (
        <LeagueAdminPanel
          key={`${hub.league.id}-${hub.league.joinCode}-${hub.league.rules.format}-${hub.league.delegates.map((delegate) => delegate.userId).join(",")}`}
          league={hub.league}
          pending={pending}
          onSave={saveLeagueAdmin}
          onRemove={remove}
          onGrant={grantDelegate}
          onRevoke={revokeDelegate}
        />
      ) : null}

      {shownTab === "lega" ? <LeagueSettings
        league={hub.league}
        name={name}
        startMatchday={startMatchday}
        endMatchday={endMatchday}
        pending={pending}
        onName={setName}
        onStart={setStartMatchday}
        onEnd={setEndMatchday}
        onSave={saveLeague}
        onRemove={remove}
      /> : null}
      {replacing ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setReplacingId(null)}>
          <div className="modal" role="dialog" aria-label={`Sostituisci ${replacing.fullName}`} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>Sostituisci {replacing.fullName}</h2>
              <button className="ghost" type="button" onClick={() => setReplacingId(null)}>Chiudi</button>
            </div>
            <p className="small muted">
              {ROLE_LABEL[replacing.role]} non in campo. Chi esce torna tra i disponibili, non in panchina.
            </p>
            {replacementPlayers.length === 0 ? <p>Nessun calciatore libero in questo ruolo.</p> : (
              <div className="stack">
                {replacementPlayers.map((player) => (
                  <button className="bench-player" key={player.id} type="button" onClick={() => replaceStarter(player)}>
                    <strong>{player.fullName}</strong>
                    <span>{player.clubShort}{benchIds.includes(player.id) ? " · in panchina" : ""}</span>
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
                  <button className="bench-player" key={player.id} type="button" onClick={() => place(player)}>
                    <strong>{player.fullName}</strong>
                    <span>{player.clubShort}{benchIds.includes(player.id) ? " · in panchina" : ""}</span>
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
      {opponents.length === 0 ? <p className="card">Nessuna squadra iscritta.</p> : (
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
      <p className="small muted">{opponent.displayName}{opponent.isMine ? " · la tua" : ""}</p>
      {useCarried ? (
        <p className="small muted">Ultima formazione salvata, giornata {carried?.from}. Non ancora confermata per questa giornata.</p>
      ) : null}
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
                  {index + 1}. {player.fullName}
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
  if (squads.length === 0) return <p className="card">Nessuna squadra iscritta.</p>;
  return (
    <div className="stack">
      {squads.map((squad) => (
        <article className="card" key={squad.fantasyTeamId}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{squad.teamName}{squad.isMine ? " · la tua" : ""}</h2>
            {squad.isMine ? <Link className="ghost" href="/rosa">Cambia la mia rosa</Link> : null}
          </div>
          <p className="small muted">{squad.displayName} · {squad.players.length} calciatori</p>
          {squad.players.length === 0 ? <p className="small muted">Rosa non ancora composta.</p> : (
            <div className="side-list">
              {squad.players.map((player) => (
                <p key={player.id} className="side-row">
                  <span>{player.fullName}</span>
                  <span className="small">{ROLE_LABEL[player.role]} · {player.clubShort}</span>
                </p>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function PlayedLineup({ sheet }: { sheet: LiveLineupSheet }) {
  const captainRated = sheet.starters.some((row) => row.isCaptain && row.voto !== null);
  return (
    <div className="stack">
      <section className="panel">
        <h2>Formazione schierata</h2>
        <PlayerScoreTable rows={sheet.starters} />
        {captainRated ? <p className="small muted">Il capitano è segnato. Nella proiezione il suo malus non è raddoppiato e la fascia non si somma.</p> : null}
      </section>
      <section className="panel">
        <h2>Panchina</h2>
        {sheet.bench.length === 0 ? <p className="small muted">Panchina vuota.</p> : <PlayerScoreTable rows={sheet.bench} />}
      </section>
      <p className="small muted">
        Proiezione: {formatPoints(sheet.partialTotal)}. È la somma dei fantavoti già pubblicati, per esempio 7 + 3 = 10, un'ammonizione −0,50, un gol subito dal portiere −1. La panchina entra solo se il titolare è ufficialmente senza voto. Difesa, bonus capitano e classifica ufficiale restano al calcolo dei 130 minuti.
      </p>
    </div>
  );
}

function PlayerScoreTable({ rows }: { rows: LiveLineupSheet["starters"] }) {
  return (
    <table className="standings as-cards">
      <thead>
        <tr>
          <th>Ruolo</th>
          <th>Calciatore</th>
          <th>Voto</th>
          <th>Bonus</th>
          <th>Malus</th>
          <th>Fantavoto</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={6}>Nessun calciatore.</td></tr>
        ) : rows.map((row) => (
          <tr key={row.playerId}>
            <td data-label="Ruolo">{ROLE_SHORT[row.role]}</td>
            <td data-label="Calciatore">
              <strong>{row.fullName}</strong>
              <span className="small muted"> · {row.clubShort}</span>
              {row.isCaptain ? <span className="live-badge">C</span> : null}
              {row.isVice ? <span className="live-badge">V</span> : null}
            </td>
            <td data-label="Voto">{formatPoints(row.voto)}</td>
            <td data-label="Bonus">{formatPoints(row.bonus)}</td>
            <td data-label="Malus">{formatPoints(row.malus)}</td>
            <td data-label="Fantavoto">
              {formatPoints(row.fantavoto)}
              {row.formula ? <span className="small muted"> · {row.formula}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LiveTable({ rows }: { rows: LeagueHubData["liveStandings"] }) {
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
        {rows.length === 0 ? (
          <tr><td colSpan={3}>Nessuna squadra iscritta.</td></tr>
        ) : rows.map((row) => (
          <tr key={row.fantasyTeamId}>
            <td data-label="Pos">{row.rank}</td>
            <td data-label="Squadra">
              <strong>{row.teamName}</strong>
              <span className="small muted"> · {row.displayName}</span>
              {row.ratedPlayers !== null ? (
                <span className="live-badge">{row.ratedPlayers}/11 con voto</span>
              ) : null}
            </td>
            <td data-label="Punti">{formatPoints(row.points)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PartialTable({ rows }: { rows: LeagueHubData["partial"] }) {
  return (
    <table className="standings as-cards">
      <thead>
        <tr>
          <th>Pos</th>
          <th>Squadra</th>
          <th>Punti giornata</th>
          <th>Formazione</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={4}>Nessuna squadra iscritta.</td></tr>
        ) : rows.map((row) => (
          <tr key={row.fantasyTeamId}>
            <td data-label="Pos">{row.rank || "—"}</td>
            <td data-label="Squadra">
              <strong>{row.teamName}</strong>
              <span className="small muted"> · {row.displayName}</span>
              {row.live ? <span className="live-badge">live</span> : null}
            </td>
            <td data-label="Punti giornata">{row.points === null ? "—" : formatPoints(row.points)}</td>
            <td data-label="Formazione">{row.filed ? "Schierata" : "Non schierata"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeagueSettings({
  league,
  name,
  startMatchday,
  endMatchday,
  pending,
  onName,
  onStart,
  onEnd,
  onSave,
  onRemove,
}: {
  league: LeagueDetail;
  name: string;
  startMatchday: number;
  endMatchday: number;
  pending: boolean;
  onName: (value: string) => void;
  onStart: (value: number) => void;
  onEnd: (value: number) => void;
  onSave: (regenerateCode?: boolean) => Promise<void>;
  onRemove: (fantasyTeamId: string) => Promise<void>;
}) {
  return (
    <div className="grid-2">
      <section className="card stack">
        <h2>Codice invito</h2>
        <div className="code">{league.joinCode}</div>
        <div className="row">
          <CopyInviteLink code={league.joinCode} />
          <button className="ghost" type="button" onClick={() => void navigator.clipboard.writeText(league.joinCode)}>Copia codice</button>
          {league.isOwner ? (
            <button className="ghost" type="button" disabled={pending} onClick={() => void onSave(true)}>Genera un nuovo codice</button>
          ) : null}
        </div>
        {league.isOwner ? (
          <form className="stack" onSubmit={(event) => { event.preventDefault(); void onSave(false); }}>
            <label>
              Nome della lega
              <input value={name} onChange={(event) => onName(event.target.value)} />
            </label>
            <div className="row">
              <label>
                Dalla giornata
                <input type="number" min={1} max={league.roundCount > 0 ? league.roundCount : undefined} value={startMatchday} onChange={(event) => onStart(Number(event.target.value))} />
              </label>
              <label>
                Alla giornata
                <input type="number" min={1} max={league.roundCount > 0 ? league.roundCount : undefined} value={endMatchday} onChange={(event) => onEnd(Number(event.target.value))} />
              </label>
            </div>
            {!league.rangeReady ? (
              <p className="small muted">Per memorizzare il range esegui league_hub.sql su Supabase.</p>
            ) : (
              <p className="small muted">
                {league.roundCount > 0
                  ? `Il calendario di questa competizione ha ${league.roundCount} turni.`
                  : "Il calendario di questa competizione non ha ancora giornate."}
              </p>
            )}
            <button className="primary" type="submit" disabled={pending || name.trim().length < 2}>Salva impostazioni</button>
          </form>
        ) : <p>Range e impostazioni restano a chi ha creato la lega.</p>}
      </section>
      <section className="card">
        <h2>Partecipanti</h2>
        <p>{league.participants.length === 0 ? "Nessuna squadra iscritta." : `${league.participants.length} squadre`}</p>
        <ul className="list">
          {league.participants.map((participant) => (
            <li className="person" key={participant.fantasyTeamId}>
              <span className="person-main">
                <strong>{participant.teamName}</strong>
                <span className="small muted">{participant.displayName}</span>
              </span>
              {league.isOwner ? (
                <button className="text-button" type="button" disabled={pending} onClick={() => void onRemove(participant.fantasyTeamId)}>
                  Rimuovi
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
