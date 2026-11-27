"use client";

import { TeamBadge } from "@/components/TeamBadge";
import { type CompactPlayer, type LineBonuses, type LineEvent } from "@/lib/lineups/compact-sheet";
import type { PlayerRole } from "@/lib/types";

export type { CompactPlayer, LineBonuses, LineEvent } from "@/lib/lineups/compact-sheet";
export { compactFromAudit, eventsFromAudit } from "@/lib/lineups/compact-sheet";

const ROLE: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };
const ROLE_NAME: Record<PlayerRole, string> = {
  GK: "Portieri",
  DEF: "Difensori",
  MID: "Centrocampisti",
  FWD: "Attaccanti",
};

const EVENT_LABEL: Record<LineEvent, string> = {
  goal: "Gol",
  assist: "Assist",
  yellow: "Ammonizione",
  red: "Espulsione",
  own: "Autogol",
  miss: "Rigore sbagliato",
  save: "Rigore parato",
  conceded: "Gol subito",
  clean: "Porta inviolata",
};

function voteText(value: number | null, empty: string) {
  if (value == null) return empty;
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function signed(value: number) {
  const text = value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return value > 0 ? `+${text}` : text;
}

function eventLabel(kind: LineEvent, count: number) {
  const name = EVENT_LABEL[kind];
  return count > 1 ? `${count} ${name.toLowerCase()}` : name;
}

function EventIcon({ kind }: { kind: LineEvent }) {
  if (kind === "goal") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 1.8 6.2 5.2 8 6.4 9.8 5.2zM3.2 6.2 6.2 5.2 5.4 8.2 3.2 8.6zM12.8 6.2 9.8 5.2 10.6 8.2 12.8 8.6zM5.2 10.2 8 8.8 10.8 10.2 9.6 13.4H6.4z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "assist") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 11.5 8 3.5l6 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.2 11.5h5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "yellow" || kind === "red") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="4.2" y="2" width="7.6" height="12" rx="1.2" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "clean") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.6 13 3.6v4.2c0 3.2-2.1 5.2-5 6.6-2.9-1.4-5-3.4-5-6.6V3.6z" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.4 8.1 7.2 9.8 10.7 6.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  const letter = kind === "own" ? "AG" : kind === "miss" ? "R" : kind === "save" ? "P" : "GS";
  return <b className="xi-letter">{letter}</b>;
}

function EventMark({ kind, count }: { kind: LineEvent; count: number }) {
  return (
    <span className={`xi-badge ${kind}`} title={eventLabel(kind, count)} aria-label={eventLabel(kind, count)}>
      <EventIcon kind={kind} />
      {count > 1 ? <b>{count}</b> : null}
    </span>
  );
}

function Row({ player, empty }: { player: CompactPlayer; empty: string }) {
  return (
    <div className="xi-row" data-out={!player.played} data-in={player.entered}>
      <span className={`role-pip ${player.role}`}>{ROLE[player.role]}</span>
      <span className="xi-who">
        <TeamBadge teamName={player.club || player.name} />
        <strong>{player.name}</strong>
        {player.captain ? <em className="xi-cap">C</em> : null}
        {player.entered ? <em className="xi-in">IN</em> : null}
        {player.events.length > 0 ? (
          <span className="xi-events">
            {player.events.map((event) => (
              <EventMark key={`${player.id}-${event.kind}`} kind={event.kind} count={event.count} />
            ))}
          </span>
        ) : null}
      </span>
      <span className="xi-vote">{voteText(player.vote, player.emptyText ?? empty)}</span>
      <span className="xi-fanta">{voteText(player.fanta, player.emptyText ?? empty)}</span>
    </div>
  );
}

function BonusBar({ bonuses }: { bonuses: LineBonuses }) {
  return (
    <div className="xi-bonus">
      <span>Fair Play<strong>{signed(bonuses.fairPlay)}</strong></span>
      <span>Bonus capitano<strong>{signed(bonuses.captain)}</strong></span>
      <span>Modificatore difesa<strong>{bonuses.defenseOn ? signed(bonuses.defense) : "Spento"}</strong></span>
    </div>
  );
}

export function CompactLineup({
  starters,
  bench,
  empty = "S.V.",
  bonuses,
}: {
  starters: CompactPlayer[];
  bench: CompactPlayer[];
  empty?: string;
  bonuses?: LineBonuses | null;
}) {
  const roles = (["GK", "DEF", "MID", "FWD"] as const)
    .map((role) => ({ role, players: starters.filter((player) => player.role === role) }))
    .filter((group) => group.players.length > 0);
  return (
    <div className="xi-sheet">
      <div className="xi-row xi-labels" aria-hidden="true">
        <span />
        <span />
        <span>Voto</span>
        <span>FV</span>
      </div>
      <p className="xi-head">Titolari</p>
      {roles.length === 0 ? <p className="small muted">Nessun titolare.</p> : roles.map((group) => (
        <div key={group.role}>
          <p className="xi-role">{ROLE_NAME[group.role]}</p>
          {group.players.map((player) => <Row key={player.id} player={player} empty={empty} />)}
        </div>
      ))}
      <p className="xi-head">Panchina</p>
      {bench.length === 0 ? <p className="small muted">Panchina vuota.</p> : bench.map((player) => (
        <Row key={player.id} player={player} empty={empty} />
      ))}
      {bonuses ? <BonusBar bonuses={bonuses} /> : null}
    </div>
  );
}
