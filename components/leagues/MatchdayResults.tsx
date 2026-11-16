"use client";

import { useEffect, useState } from "react";
import { ClubPair } from "@/components/TeamBadge";
import { CompactLineup, compactFromAudit, type CompactPlayer } from "@/components/lineups/CompactLineup";
import type { ScoreAudit } from "@/lib/engine/score-audit";
import type { LeagueHubData, LiveLineupSheet, OpponentLineup } from "@/lib/types";

const kickoff = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

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
    events: [],
  });
  return { starters: sheet.starters.map(map), bench: sheet.bench.map(map) };
}

export function MatchdayResults({
  hub,
  pending,
  onSelect,
}: {
  hub: LeagueHubData;
  pending: boolean;
  onSelect: (gameweekId: string) => void;
}) {
  const weeks = [...hub.gameweeks].sort((left, right) => left.number - right.number);
  const index = Math.max(0, weeks.findIndex((week) => week.id === hub.selectedGameweekId));
  const current = weeks[index] ?? null;
  const [openId, setOpenId] = useState<string | null>(null);
  const scored = current?.status === "scored" || current?.status === "final";
  const pointsById = new Map(hub.partial.map((row) => [row.fantasyTeamId, row]));
  const teams = [...hub.opponents].sort((left, right) => {
    const leftRank = pointsById.get(left.fantasyTeamId)?.rank ?? 99;
    const rightRank = pointsById.get(right.fantasyTeamId)?.rank ?? 99;
    return leftRank - rightRank || left.teamName.localeCompare(right.teamName, "it");
  });

  useEffect(() => {
    setOpenId(null);
  }, [hub.selectedGameweekId]);

  return (
    <section className="stack">
      <div className="gw-stepper">
        <button
          className="ghost"
          type="button"
          aria-label="Giornata precedente"
          disabled={pending || index <= 0}
          onClick={() => { const week = weeks[index - 1]; if (week) onSelect(week.id); }}
        >
          ‹
        </button>
        <select
          aria-label="Giornata"
          value={current?.id ?? ""}
          disabled={pending || weeks.length === 0}
          onChange={(event) => onSelect(event.target.value)}
        >
          {weeks.map((week) => (
            <option key={week.id} value={week.id}>
              Giornata {week.number}{week.id === hub.home.focusGameweekId ? " · in corso" : ""}
            </option>
          ))}
        </select>
        <button
          className="ghost"
          type="button"
          aria-label="Giornata successiva"
          disabled={pending || index >= weeks.length - 1}
          onClick={() => { const week = weeks[index + 1]; if (week) onSelect(week.id); }}
        >
          ›
        </button>
      </div>

      <article className="card">
        <h2>Serie A{current ? ` · giornata ${current.number}` : ""}</h2>
        {hub.home.selectedFixtures.length === 0 ? (
          <p className="small muted">Nessun incontro in questa giornata.</p>
        ) : (
          <div className="cal-matches">
            {hub.home.selectedFixtures.map((fixture) => {
              const hasScore = fixture.homeGoals != null && fixture.awayGoals != null;
              return (
                <p className="cal-match" key={fixture.id}>
                  <ClubPair
                    home={fixture.home}
                    away={fixture.away}
                    score={hasScore ? `${fixture.homeGoals}–${fixture.awayGoals}` : null}
                  />
                  <span className="small muted">{hasScore ? "Finale" : kickoff.format(new Date(fixture.kickoffAt))}</span>
                </p>
              );
            })}
          </div>
        )}
      </article>

      <article className="card">
        <h2>Squadre della lega</h2>
        {teams.length === 0 ? <p className="small muted">Nessuna squadra iscritta.</p> : (
          <div className="cal-teams">
            {teams.map((team) => {
              const standing = pointsById.get(team.fantasyTeamId);
              const open = openId === team.fantasyTeamId;
              return (
                <div key={team.fantasyTeamId}>
                  <button className="cal-team" type="button" data-open={open} onClick={() => setOpenId(open ? null : team.fantasyTeamId)}>
                    <span className="cal-rank">{standing?.points == null ? "–" : standing.rank}</span>
                    <span className="cal-name">
                      <strong>{team.teamName}</strong>
                      <span>{team.displayName}{team.isMine ? " · la tua" : ""}</span>
                    </span>
                    <span className="cal-points">{points(standing?.points ?? null)}</span>
                  </button>
                  {open && current ? (
                    <TeamLineup
                      leagueId={hub.league.id}
                      gameweekId={current.id}
                      opponent={team}
                      scored={Boolean(scored)}
                      live={team.isMine && hub.home.gameweekNumber === current.number ? hub.liveSheet : null}
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

function TeamLineup({
  leagueId,
  gameweekId,
  opponent,
  scored,
  live,
}: {
  leagueId: string;
  gameweekId: string;
  opponent: OpponentLineup;
  scored: boolean;
  live: LiveLineupSheet | null;
}) {
  const [audit, setAudit] = useState<ScoreAudit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scored || !opponent.filed || !opponent.revealed) return;
    let cancel = false;
    void (async () => {
      try {
        const response = await fetch(`/api/leagues/${leagueId}/matchday?gameweekId=${gameweekId}&fantasyTeamId=${opponent.fantasyTeamId}`);
        const body = await response.json() as ScoreAudit & { error?: string };
        if (cancel) return;
        if (!response.ok) throw new Error(body.error ?? "Formazione non disponibile.");
        setAudit(body);
      } catch (reason) {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Formazione non disponibile.");
      }
    })();
    return () => { cancel = true; };
  }, [scored, opponent.filed, opponent.revealed, opponent.fantasyTeamId, leagueId, gameweekId]);

  if (!opponent.filed) return <p className="small muted cal-note">Non ha schierato.</p>;
  if (!opponent.revealed) return <p className="small muted cal-note">La formazione si apre alla deadline.</p>;
  if (audit) {
    const rows = compactFromAudit(audit.players);
    return (
      <div className="cal-lineup">
        <CompactLineup starters={rows.starters} bench={rows.bench} />
        <p className="small muted">Fantapunti {points(audit.sum.total)}</p>
      </div>
    );
  }
  if (live) {
    const rows = fromLive(live);
    return (
      <div className="cal-lineup">
        <CompactLineup starters={rows.starters} bench={rows.bench} empty="—" />
        <p className="small muted">Proiezione {points(live.partialTotal)}. Il totale ufficiale arriva al calcolo della giornata.</p>
      </div>
    );
  }
  const rows = fromSlots(opponent);
  return (
    <div className="cal-lineup">
      {error ? <p className="small muted">{error}</p> : null}
      <CompactLineup starters={rows.starters} bench={rows.bench} empty="—" />
      {scored && !error ? <p className="small muted">Carico i voti…</p> : null}
      {!scored ? <p className="small muted">I voti compaiono quando la giornata è calcolata.</p> : null}
    </div>
  );
}
