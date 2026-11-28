"use client";

import { TeamBadge } from "@/components/TeamBadge";
import { ScoreIcon } from "@/components/scores/ScoreIcons";
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
  penalty: "Rigore segnato",
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

/** Le icone di bonus e malus, le stesse del dettaglio di una giornata calcolata. */
export function EventMarks({ events }: { events: CompactPlayer["events"] }) {
  if (events.length === 0) return null;
  return (
    <span className="xi-events">
      {events.map(({ kind, count }) => (
        <span className={`xi-badge ${kind}`} key={kind} title={eventLabel(kind, count)} aria-label={eventLabel(kind, count)}>
          <ScoreIcon kind={kind} />
          {count > 1 ? <b>{count}</b> : null}
        </span>
      ))}
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
        {player.captain ? <em className="xi-cap" title="Capitano" aria-label="Capitano">C</em> : null}
        {player.vice ? <em className="xi-cap" title="Vice capitano" aria-label="Vice capitano">V</em> : null}
        {player.entered ? <em className="xi-in">IN</em> : null}
        <EventMarks events={player.events} />
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
