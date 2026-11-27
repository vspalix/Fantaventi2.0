"use client";

import { useEffect, useRef, useState } from "react";
import { InfoTip } from "@/components/InfoTip";
import { CompactLineup, type CompactPlayer } from "@/components/lineups/CompactLineup";
import { compactFromLive, LIVE_NOTE } from "@/lib/lineups/compact-sheet";
import { TeamDetail } from "@/components/scores/TeamDetail";
import type { ScoreAudit } from "@/lib/engine/score-audit";
import type { LeagueHubData, OpponentLineup } from "@/lib/types";
import { readableError } from "@/lib/feedback";

/** Quante squadre alla volta: la classifica resta veloce anche con tantissimi iscritti. */
const PAGE = 50;

type CalendarWeek = {
  selectedGameweekId: string;
  number: number;
  opponents: OpponentLineup[];
  partial: LeagueHubData["partial"];
  selectedFixtures: LeagueHubData["home"]["selectedFixtures"];
};

/** Il dettaglio di una squadra in una giornata calcolata. */
type Detail =
  | { state: "ok"; audit: ScoreAudit }
  | { state: "none" }
  | { state: "error"; text: string };

type Standing = LeagueHubData["partial"][number];

function points(value: number | null) {
  if (value == null) return "—";
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function fromSlots(opponent: OpponentLineup): { starters: CompactPlayer[]; bench: CompactPlayer[] } {
  const starter = (slot: OpponentLineup["slots"][number]): CompactPlayer => ({
    id: slot.playerId,
    name: slot.fullName,
    role: slot.role,
    club: slot.clubShort,
    vote: null,
    fanta: null,
    captain: slot.isCaptain,
    vice: slot.isVice,
    played: false,
    entered: false,
    events: [],
  });
  return {
    starters: opponent.slots.map(starter),
    bench: opponent.bench.map((player) => ({
      id: player.playerId,
      name: player.fullName,
      role: player.role,
      club: player.clubShort,
      vote: null,
      fanta: null,
      played: false,
      entered: false,
      events: [],
    })),
  };
}

/** La giornata chiesta da un link e se mostrare subito la propria formazione. */
export type Arrival = { round: number; openMine: boolean };

export function MatchdayResults({ hub, arrival, onArrived }: { hub: LeagueHubData; arrival: Arrival | null; onArrived: () => void }) {
  const weeks = [...hub.gameweeks].sort((left, right) => left.number - right.number);
  const [week, setWeek] = useState<CalendarWeek | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wanted] = useState(() => {
    const target = arrival ? weeks.find((item) => item.number === arrival.round) : undefined;
    if (!arrival || !target) return null;
    return { id: target.id, openId: arrival.openMine ? "mine" : null, elsewhere: target.id !== hub.selectedGameweekId };
  });
  /** Giornata chiesta dal link e non ancora arrivata: intanto non se ne mostra un'altra. */
  const [arriving, setArriving] = useState(wanted?.elsewhere ? wanted.id : null);
  /** Cosa è aperto: «mine» per il riquadro in alto, altrimenti la squadra in classifica. */
  const [openId, setOpenId] = useState<string | null>(wanted && !wanted.elsewhere ? wanted.openId : null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const asked = useRef(new Set<string>());
  const [visible, setVisible] = useState(PAGE);
  const selectedId = week?.selectedGameweekId ?? hub.selectedGameweekId;
  const index = Math.max(0, weeks.findIndex((item) => item.id === (arriving ?? selectedId)));
  const current = weeks[index] ?? null;
  const opponents = week?.opponents ?? hub.opponents;
  const partial = week?.partial ?? hub.partial;
  const scored = current?.status === "scored" || current?.status === "final";
  const pointsById = new Map(partial.map((row) => [row.fantasyTeamId, row]));
  // Chi non ha punti va in fondo: il suo posto in classifica non esiste.
  const place = (teamId: string) => {
    const row = pointsById.get(teamId);
    return row?.points == null ? Number.MAX_SAFE_INTEGER : row.rank;
  };
  const teams = [...opponents].sort((left, right) => (
    place(left.fantasyTeamId) - place(right.fantasyTeamId) || left.teamName.localeCompare(right.teamName, "it")
  ));
  const gameweekId = current?.id ?? "";
  const mine = teams.find((team) => team.isMine) ?? null;
  const mineIndex = teams.findIndex((team) => team.isMine);
  const mineStanding = mine ? pointsById.get(mine.fantasyTeamId) : undefined;
  const best = teams.length > 0 ? pointsById.get(teams[0].fantasyTeamId)?.points ?? null : null;
  const requested = useRef(wanted);
  const hubWeekId = useRef(hub.selectedGameweekId);
  const detailKey = (teamId: string) => `${gameweekId}:${teamId}`;

  async function loadDetail(teamId: string) {
    const key = detailKey(teamId);
    if (asked.current.has(key)) return;
    asked.current.add(key);
    try {
      const response = await fetch(`/api/leagues/${hub.league.id}/matchday?gameweekId=${gameweekId}&fantasyTeamId=${teamId}`);
      const body = await response.json() as ScoreAudit & { error?: string };
      if (response.status === 404) {
        setDetails((kept) => ({ ...kept, [key]: { state: "none" } }));
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Voti non disponibili.");
      setDetails((kept) => ({ ...kept, [key]: { state: "ok", audit: body } }));
    } catch (reason) {
      // Si potrà richiedere di nuovo.
      asked.current.delete(key);
      setDetails((kept) => ({ ...kept, [key]: { state: "error", text: readableError(reason, "Voti non disponibili.") } }));
    }
  }

  // Il dettaglio della propria squadra si prepara subito, così al tocco è già lì.
  const mineId = mine?.filed ? mine.fantasyTeamId : "";
  useEffect(() => {
    if (scored && gameweekId && mineId) void loadDetail(mineId);
    // loadDetail cambia a ogni disegno: contano solo giornata e squadra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scored, gameweekId, mineId]);

  function toggle(key: string, team: OpponentLineup) {
    const opening = openId !== key;
    setOpenId(opening ? key : null);
    // Per chi non ha schierato non c’è nulla da chiedere.
    if (opening && scored && team.filed) void loadDetail(team.fantasyTeamId);
  }

  function goToMine() {
    if (mineIndex < 0) return;
    if (mineIndex >= visible) setVisible(mineIndex + 10);
    window.setTimeout(() => {
      document.getElementById("gd-mine-row")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  const detailFor = (team: OpponentLineup) => (
    <TeamBlock
      opponent={team}
      scored={Boolean(scored)}
      detail={details[detailKey(team.fantasyTeamId)] ?? null}
      onRetry={() => void loadDetail(team.fantasyTeamId)}
    />
  );

  useEffect(() => {
    if (hubWeekId.current === hub.selectedGameweekId) return;
    hubWeekId.current = hub.selectedGameweekId;
    setWeek(null);
    setOpenId(null);
    setVisible(PAGE);
  }, [hub.selectedGameweekId]);

  async function choose(gameweekId: string, open: string | null = null) {
    if (!gameweekId || gameweekId === selectedId || pending) return;
    setPending(true);
    setError(null);
    setOpenId(null);
    try {
      const response = await fetch(`/api/leagues/${hub.league.id}/hub?gameweek=${gameweekId}&view=calendar`);
      const body = await response.json() as { calendar?: CalendarWeek; error?: string };
      if (!response.ok || !body.calendar) throw new Error(body.error ?? "Giornata non disponibile.");
      setWeek(body.calendar);
      setVisible(PAGE);
      setOpenId(open);
    } catch (reason) {
      setError(readableError(reason, "Giornata non disponibile."));
    } finally {
      setArriving(null);
      setPending(false);
    }
  }

  // Arrivando da un link con una giornata (per esempio dai pallini della Home), apre quella giornata una volta sola.
  useEffect(() => {
    const target = requested.current;
    requested.current = null;
    if (arrival) onArrived();
    // Chi arriva per vedere la propria formazione parte dal suo riquadro, in cima.
    if (target?.openId) window.scrollTo(0, 0);
    if (target?.elsewhere) void choose(target.id, target.openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="stack">
      <div className="gw-stepper">
        <button
          className="ghost"
          type="button"
          aria-label="Giornata precedente"
          disabled={pending || Boolean(arriving) || index <= 0}
          onClick={() => { const previous = weeks[index - 1]; if (previous) void choose(previous.id); }}
        >
          ‹
        </button>
        <select
          aria-label="Giornata"
          value={current?.id ?? ""}
          disabled={pending || Boolean(arriving) || weeks.length === 0}
          onChange={(event) => void choose(event.target.value)}
        >
          {weeks.map((item) => (
            <option key={item.id} value={item.id}>
              Giornata {item.number}{item.id === hub.home.focusGameweekId ? " · in corso" : ""}
            </option>
          ))}
        </select>
        <button
          className="ghost"
          type="button"
          aria-label="Giornata successiva"
          disabled={pending || Boolean(arriving) || index >= weeks.length - 1}
          onClick={() => { const next = weeks[index + 1]; if (next) void choose(next.id); }}
        >
          ›
        </button>
      </div>
      {error ? <p className="banner">{error}</p> : null}

      {arriving ? (
        <div className="stack gd-loading" role="status" aria-label="Carico la giornata" aria-busy="true">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : (
        <>
          {mine ? (
            <article className="card gd-mine">
              <p className="gd-kicker">La tua squadra</p>
              {/* Senza punti non c'è ancora una posizione: restano nome e spiegazione. */}
              <div className="gd-mine-row">
                {mineStanding?.points != null ? (
                  <span className="gd-place">
                    <strong>{mineStanding.rank}°</strong>
                    <small>su {teams.length}</small>
                  </span>
                ) : null}
                <span className="gd-mine-name">
                  <strong>{mine.teamName}</strong>
                  <small>{mineNote(mineStanding, best, Boolean(scored))}</small>
                </span>
                {mineStanding?.points != null ? (
                  <span className="gd-mine-points">
                    <strong>{points(mineStanding.points)}</strong>
                    <small>fantapunti</small>
                  </span>
                ) : null}
              </div>
              <button className="ghost gd-open" type="button" aria-expanded={openId === "mine"} onClick={() => toggle("mine", mine)}>
                {openId === "mine" ? "Chiudi il dettaglio" : "Vedi il dettaglio"}
              </button>
              {openId === "mine" ? detailFor(mine) : null}
            </article>
          ) : null}

          <article className="card gd-ranking">
            <div className="gd-title">
              <h2>Classifica di giornata</h2>
              <InfoTip label="Classifica di giornata">Posizione e punti di questa giornata. Tocca una squadra per vedere formazione, voti e bonus.</InfoTip>
              {mineIndex >= 0 && teams.length > 8 ? (
                <button className="text-button" type="button" onClick={goToMine}>Vai alla mia posizione</button>
              ) : null}
            </div>
            {teams.length === 0 ? <p className="small muted">Nessuna squadra iscritta.</p> : (
              <div className="cal-teams">
                {teams.slice(0, visible).map((team) => {
                  const open = openId === team.fantasyTeamId;
                  return (
                    <div className="gd-team" key={team.fantasyTeamId} id={team.isMine ? "gd-mine-row" : undefined}>
                      <TeamRow
                        team={team}
                        standing={pointsById.get(team.fantasyTeamId)}
                        open={open}
                        onOpen={() => toggle(team.fantasyTeamId, team)}
                      />
                      {open ? detailFor(team) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {teams.length > visible ? (
              <button className="ghost" type="button" onClick={() => setVisible(visible + PAGE)}>
                Mostra altre {Math.min(PAGE, teams.length - visible)}
              </button>
            ) : null}
          </article>
        </>
      )}
    </section>
  );
}

function mineNote(standing: Standing | undefined, best: number | null, scored: boolean) {
  if (standing?.points == null) return "I punti arrivano quando la giornata è calcolata.";
  const gap = best == null ? 0 : best - standing.points;
  const where = gap <= 0 ? "Primo posto di giornata" : `${points(gap)} dal primo`;
  return scored ? where : `${where} · provvisorio`;
}

function TeamRow({
  team,
  standing,
  open,
  onOpen,
}: {
  team: OpponentLineup;
  standing: { rank: number; points: number | null } | undefined;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button className="cal-team" type="button" aria-expanded={open} data-open={open} data-mine={team.isMine} onClick={onOpen}>
      <span className="cal-rank">{standing?.points == null ? "–" : `${standing.rank}°`}</span>
      <span className="cal-name">
        <strong>{team.teamName}</strong>
        <span>{[team.displayName, team.isMine ? "la tua" : ""].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="cal-points">{points(standing?.points ?? null)}</span>
      <span className="cal-chevron" aria-hidden="true">›</span>
    </button>
  );
}

function TeamBlock({
  opponent,
  scored,
  detail,
  onRetry,
}: {
  opponent: OpponentLineup;
  scored: boolean;
  detail: Detail | null;
  onRetry: () => void;
}) {
  if (!opponent.filed || detail?.state === "none") return <p className="small muted cal-note">Non ha schierato.</p>;
  if (!opponent.revealed) return <p className="small muted cal-note">La formazione si apre alla deadline.</p>;
  if (scored) {
    if (!detail) {
      return (
        <div className="stack gd-loading" role="status" aria-label="Carico il dettaglio">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      );
    }
    if (detail.state === "error") {
      return (
        <div className="stack gd-loading">
          <p className="banner">{detail.text}</p>
          <button className="ghost" type="button" onClick={onRetry}>Riprova</button>
        </div>
      );
    }
    return <TeamDetail audit={detail.audit} />;
  }
  const live = opponent.sheet;
  const rows = live ? compactFromLive(live) : fromSlots(opponent);
  return (
    <div className="cal-lineup">
      {opponent.office ? <p className="small muted">Formazione d&apos;ufficio: non salvata in tempo.</p> : null}
      <CompactLineup starters={rows.starters} bench={rows.bench} empty="—" />
      {live ? (
        <>
          <p className="small">Totale in diretta: <strong>{points(live.partialTotal)}</strong></p>
          {live.penalty != null ? (
            <p className="small muted">In questa lega chi non salva la formazione prende la penalità: {points(live.penalty)} punti.</p>
          ) : null}
          <p className="small muted">{LIVE_NOTE}</p>
        </>
      ) : (
        <p className="small muted">I voti compaiono quando la giornata è calcolata.</p>
      )}
    </div>
  );
}
