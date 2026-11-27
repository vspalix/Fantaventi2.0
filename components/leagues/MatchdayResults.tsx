"use client";

import { useEffect, useRef, useState } from "react";
import { InfoTip } from "@/components/InfoTip";
import { CompactLineup, type CompactPlayer, type LineBonuses } from "@/components/lineups/CompactLineup";
import type { LeagueHubData, LiveLineupSheet, OpponentLineup } from "@/lib/types";
import { readableError } from "@/lib/feedback";

type CalendarWeek = {
  selectedGameweekId: string;
  number: number;
  opponents: OpponentLineup[];
  partial: LeagueHubData["partial"];
  selectedFixtures: LeagueHubData["home"]["selectedFixtures"];
};

type Sheet = {
  fantasyTeamId: string;
  total: number;
  starters: CompactPlayer[];
  bench: CompactPlayer[];
  bonuses?: LineBonuses;
};

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

function fromLive(sheet: LiveLineupSheet): { starters: CompactPlayer[]; bench: CompactPlayer[] } {
  const map = (row: LiveLineupSheet["starters"][number]): CompactPlayer => ({
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
  });
  return { starters: sheet.starters.map(map), bench: sheet.bench.map(map) };
}

export function MatchdayResults({ hub, initialRound }: { hub: LeagueHubData; initialRound?: number }) {
  const weeks = [...hub.gameweeks].sort((left, right) => left.number - right.number);
  const [week, setWeek] = useState<CalendarWeek | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Record<string, Sheet[]>>({});
  const selectedId = week?.selectedGameweekId ?? hub.selectedGameweekId;
  const index = Math.max(0, weeks.findIndex((item) => item.id === selectedId));
  const current = weeks[index] ?? null;
  const opponents = week?.opponents ?? hub.opponents;
  const partial = week?.partial ?? hub.partial;
  const scored = current?.status === "scored" || current?.status === "final";
  const pointsById = new Map(partial.map((row) => [row.fantasyTeamId, row]));
  const teams = [...opponents].sort((left, right) => {
    const leftRank = pointsById.get(left.fantasyTeamId)?.rank ?? 99;
    const rightRank = pointsById.get(right.fantasyTeamId)?.rank ?? 99;
    return leftRank - rightRank || left.teamName.localeCompare(right.teamName, "it");
  });
  const loaded = current ? sheets[current.id] : undefined;
  const gameweekId = current?.id ?? "";
  const mine = teams.find((team) => team.isMine) ?? null;
  const mineStanding = mine ? pointsById.get(mine.fantasyTeamId) : undefined;
  const requestedRound = useRef(initialRound);

  useEffect(() => {
    setWeek(null);
    setOpenId(null);
  }, [hub.selectedGameweekId]);

  useEffect(() => {
    if (!gameweekId || !scored || sheets[gameweekId]) return;
    let cancel = false;
    void (async () => {
      try {
        const response = await fetch(`/api/leagues/${hub.league.id}/matchday?gameweekId=${gameweekId}&scope=sheets`);
        const body = await response.json() as { sheets?: Sheet[]; error?: string };
        if (cancel) return;
        if (!response.ok) throw new Error(body.error ?? "Voti non disponibili.");
        setSheets((cache) => ({ ...cache, [gameweekId]: body.sheets ?? [] }));
      } catch (reason) {
        if (!cancel) setError(readableError(reason, "Voti non disponibili."));
      }
    })();
    return () => { cancel = true; };
  }, [gameweekId, scored, sheets, hub.league.id]);

  async function choose(gameweekId: string) {
    if (!gameweekId || gameweekId === selectedId || pending) return;
    setPending(true);
    setError(null);
    setOpenId(null);
    try {
      const response = await fetch(`/api/leagues/${hub.league.id}/hub?gameweek=${gameweekId}&view=calendar`);
      const body = await response.json() as { calendar?: CalendarWeek; error?: string };
      if (!response.ok || !body.calendar) throw new Error(body.error ?? "Giornata non disponibile.");
      setWeek(body.calendar);
    } catch (reason) {
      setError(readableError(reason, "Giornata non disponibile."));
    } finally {
      setPending(false);
    }
  }

  // Arrivando da un link con una giornata (per esempio dai pallini della Home), apre quella giornata una volta sola.
  useEffect(() => {
    const number = requestedRound.current;
    requestedRound.current = undefined;
    if (number == null) return;
    const target = weeks.find((item) => item.number === number);
    if (target) void choose(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="stack">
      <div className="gw-stepper">
        <button
          className="ghost"
          type="button"
          aria-label="Giornata precedente"
          disabled={pending || index <= 0}
          onClick={() => { const previous = weeks[index - 1]; if (previous) void choose(previous.id); }}
        >
          ‹
        </button>
        <select
          aria-label="Giornata"
          value={current?.id ?? ""}
          disabled={pending || weeks.length === 0}
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
          disabled={pending || index >= weeks.length - 1}
          onClick={() => { const next = weeks[index + 1]; if (next) void choose(next.id); }}
        >
          ›
        </button>
      </div>
      {error ? <p className="banner">{error}</p> : null}

      <article className="card">
        <h2>Risultati giornata{current ? ` ${current.number}` : ""}</h2>
        <p className="small muted">Tocca una squadra per vedere la formazione e i voti <InfoTip label="Risultati di giornata">Posizione e punti di questa giornata. La tua squadra resta in alto e anche al suo posto in elenco.</InfoTip></p>
        {teams.length === 0 ? <p className="small muted">Nessuna squadra iscritta.</p> : (
          <div className="cal-teams">
            {mine ? (
              <TeamRow
                team={mine}
                standing={mineStanding}
                open={openId === mine.fantasyTeamId}
                featured
                onOpen={() => setOpenId(openId === mine.fantasyTeamId ? null : mine.fantasyTeamId)}
              />
            ) : null}
            {mine && openId === mine.fantasyTeamId && current ? (
              <TeamLineup
                opponent={mine}
                scored={Boolean(scored)}
                sheet={loaded?.find((item) => item.fantasyTeamId === mine.fantasyTeamId) ?? null}
                waiting={Boolean(scored && !loaded)}
                live={hub.home.gameweekNumber === current.number ? hub.liveSheet : null}
              />
            ) : null}
            {teams.map((team) => {
              const standing = pointsById.get(team.fantasyTeamId);
              const open = openId === team.fantasyTeamId;
              const sheet = loaded?.find((item) => item.fantasyTeamId === team.fantasyTeamId) ?? null;
              return (
                <div key={team.fantasyTeamId}>
                  <TeamRow
                    team={team}
                    standing={standing}
                    open={open}
                    onOpen={() => setOpenId(open ? null : team.fantasyTeamId)}
                  />
                  {open && current && !team.isMine ? (
                    <TeamLineup
                      opponent={team}
                      scored={Boolean(scored)}
                      sheet={sheet}
                      waiting={Boolean(scored && !loaded)}
                      live={null}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}

function TeamRow({
  team,
  standing,
  open,
  featured = false,
  onOpen,
}: {
  team: OpponentLineup;
  standing: { rank: number; points: number | null } | undefined;
  open: boolean;
  featured?: boolean;
  onOpen: () => void;
}) {
  return (
    <button className="cal-team" type="button" aria-expanded={open} data-open={open} data-mine={team.isMine} data-featured={featured} onClick={onOpen}>
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

function TeamLineup({
  opponent,
  scored,
  sheet,
  waiting,
  live,
}: {
  opponent: OpponentLineup;
  scored: boolean;
  sheet: Sheet | null;
  waiting: boolean;
  live: LiveLineupSheet | null;
}) {
  if (!opponent.filed) return <p className="small muted cal-note">Non ha schierato.</p>;
  if (!opponent.revealed) return <p className="small muted cal-note">La formazione si apre alla deadline.</p>;
  if (sheet) {
    return (
      <div className="cal-lineup">
        <CompactLineup starters={sheet.starters} bench={sheet.bench} bonuses={sheet.bonuses} />
        <p className="small muted">Fantapunti {points(sheet.total)}</p>
      </div>
    );
  }
  if (live) {
    const rows = fromLive(live);
    return (
      <div className="cal-lineup">
        {opponent.office ? <p className="small muted">Formazione d&apos;ufficio: non salvata in tempo.</p> : null}
        <CompactLineup starters={rows.starters} bench={rows.bench} empty="—" />
        <p className="small muted">Proiezione {points(live.partialTotal)}. Il totale ufficiale arriva al calcolo della giornata.</p>
      </div>
    );
  }
  const rows = fromSlots(opponent);
  return (
    <div className="cal-lineup">
      {opponent.office ? <p className="small muted">Formazione d&apos;ufficio: non salvata in tempo.</p> : null}
      <CompactLineup starters={rows.starters} bench={rows.bench} empty="—" />
      {waiting ? <p className="small muted">Carico i voti…</p> : null}
      {!scored ? <p className="small muted">I voti compaiono quando la giornata è calcolata.</p> : null}
    </div>
  );
}
