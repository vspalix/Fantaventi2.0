import type { AuditPlayer } from "@/lib/engine/score-audit";
import type { PlayerRole } from "@/lib/types";

export type LineEvent = "goal" | "assist" | "yellow" | "red" | "own" | "miss" | "save" | "conceded" | "clean";

export type CompactPlayer = {
  id: string;
  name: string;
  role: PlayerRole;
  club: string;
  vote: number | null;
  fanta: number | null;
  captain?: boolean;
  vice?: boolean;
  played: boolean;
  entered: boolean;
  events: { kind: LineEvent; count: number }[];
};

export type LineBonuses = {
  captain: number;
  fairPlay: number;
  defense: number;
  defenseOn: boolean;
};

function kindOf(label: string): LineEvent | null {
  const text = label.toLowerCase();
  if (text.startsWith("assist")) return "assist";
  if (text.startsWith("ammon")) return "yellow";
  if (text.startsWith("espuls")) return "red";
  if (text.startsWith("autogol")) return "own";
  if (text.includes("sbagliato")) return "miss";
  if (text.includes("parato")) return "save";
  if (text.includes("subito")) return "conceded";
  if (text.includes("imbattib")) return "clean";
  if (text.startsWith("gol") || text.startsWith("rigore segnato")) return "goal";
  return null;
}

export function eventsFromAudit(player: AuditPlayer): CompactPlayer["events"] {
  const events: CompactPlayer["events"] = [];
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
    vice: player.vice,
    played: player.baseVote != null,
    entered: player.source === "substitute",
    events: eventsFromAudit(player),
  });
  const roleOrder: Record<string, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  const placed = players.every((player) => player.slotKind === "starter" || player.slotKind === "bench");
  const starters = (placed ? players.filter((player) => player.slotKind === "starter") : players.filter((player) => player.source !== "bench"))
    .sort((left, right) => (roleOrder[left.role] ?? 9) - (roleOrder[right.role] ?? 9) || left.slotOrder - right.slotOrder);
  const bench = (placed ? players.filter((player) => player.slotKind === "bench") : players.filter((player) => player.source === "bench"))
    .sort((left, right) => left.slotOrder - right.slotOrder);
  return {
    starters: starters.map(map),
    bench: bench.map(map),
  };
}
