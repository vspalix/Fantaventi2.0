"use client";

import { TeamBadge } from "@/components/TeamBadge";
import type { AuditPlayer } from "@/lib/engine/score-audit";
import type { PlayerRole } from "@/lib/types";

const ROLE: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };

export type LineEvent = "goal" | "assist" | "yellow" | "red" | "sub" | "own" | "miss" | "save" | "conceded";

export type CompactPlayer = {
  id: string;
  name: string;
  role: PlayerRole;
  club: string;
  vote: number | null;
  fanta: number | null;
  captain?: boolean;
  events: { kind: LineEvent; count: number }[];
};

const EVENT_LABEL: Record<LineEvent, string> = {
  goal: "Gol",
  assist: "Assist",
  yellow: "Ammonizione",
  red: "Espulsione",
  sub: "Subentrato",
  own: "Autogol",
  miss: "Rigore sbagliato",
  save: "Rigore parato",
  conceded: "Gol subito",
};

function voteText(value: number | null, empty: string) {
  if (value == null) return empty;
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function kindOf(label: string): LineEvent | null {
  const text = label.toLowerCase();
  if (text.startsWith("assist")) return "assist";
  if (text.startsWith("ammon")) return "yellow";
  if (text.startsWith("espuls")) return "red";
  if (text.startsWith("autogol")) return "own";
  if (text.includes("sbagliato")) return "miss";
  if (text.includes("parato")) return "save";
  if (text.includes("subito")) return "conceded";
  if (text.startsWith("gol") || text.startsWith("rigore segnato")) return "goal";
  return null;
}

export function eventsFromAudit(player: AuditPlayer): CompactPlayer["events"] {
  const events: CompactPlayer["events"] = [];
  if (player.source === "substitute") events.push({ kind: "sub", count: 1 });
  for (const line of player.lines) {
    const kind = kindOf(line.label);
    if (!kind || line.count === 0) continue;
    events.push({ kind, count: Math.max(1, line.count) });
  }
  return events;
}

export function compactFromAudit(players: AuditPlayer[]) {
  const map = (player: AuditPlayer): CompactPlayer => ({
    id: player.playerId,
    name: player.name,
    role: player.role,
    club: player.club ?? "",
    vote: player.baseVote,
    fanta: player.fantavoto,
    captain: player.captain,
    events: eventsFromAudit(player),
  });
  return {
    starters: players.filter((player) => player.source !== "bench").map(map),
    bench: players.filter((player) => player.source === "bench").map(map),
  };
}

function Row({ player, empty }: { player: CompactPlayer; empty: string }) {
  return (
    <div className="xi-row">
      <span className={`role-pip ${player.role}`}>{ROLE[player.role]}</span>
      <span className="xi-who">
        <TeamBadge teamName={player.club || player.name} />
        <strong>{player.name}</strong>
        {player.captain ? <em className="xi-cap">C</em> : null}
        {player.events.length > 0 ? (
          <span className="xi-events">
            {player.events.map((event) => (
              <span key={`${player.id}-${event.kind}`} className={`xi-mark ${event.kind}`} title={EVENT_LABEL[event.kind]} aria-label={EVENT_LABEL[event.kind]}>
                {event.count > 1 ? event.count : ""}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="xi-vote">{voteText(player.vote, empty)}</span>
      <span className="xi-fanta">{voteText(player.fanta, empty)}</span>
    </div>
  );
}

export function CompactLineup({
  starters,
  bench,
  empty = "S.V.",
}: {
  starters: CompactPlayer[];
  bench: CompactPlayer[];
  empty?: string;
}) {
  return (
    <div className="xi-sheet">
      <div className="xi-row xi-labels" aria-hidden="true">
        <span />
        <span />
        <span>Voto</span>
        <span>FV</span>
      </div>
      <p className="xi-head">Titolari</p>
      {starters.length === 0 ? <p className="small muted">Nessun titolare.</p> : starters.map((player) => (
        <Row key={player.id} player={player} empty={empty} />
      ))}
      <p className="xi-head">Panchina</p>
      {bench.length === 0 ? <p className="small muted">Panchina vuota.</p> : bench.map((player) => (
        <Row key={player.id} player={player} empty={empty} />
      ))}
    </div>
  );
}
