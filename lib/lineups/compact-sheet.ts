import type { AuditLine, AuditPlayer } from "@/lib/engine/score-audit";
import type { LiveLineupSheet, PlayerRole } from "@/lib/types";

export type LineEvent = "goal" | "penalty" | "assist" | "yellow" | "red" | "own" | "miss" | "save" | "conceded" | "clean";

export type CompactPlayer = {
  id: string;
  name: string;
  role: PlayerRole;
  club: string;
  vote: number | null;
  fanta: number | null;
  captain?: boolean;
  vice?: boolean;
  /** Cosa scrivere al posto del voto, se per questo calciatore è diverso. */
  emptyText?: string;
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
  if (text.startsWith("rigore segnato")) return "penalty";
  if (text.startsWith("gol")) return "goal";
  return null;
}

export function eventsFromLines(lines: readonly AuditLine[]): CompactPlayer["events"] {
  const events: CompactPlayer["events"] = [];
  for (const line of lines) {
    const kind = kindOf(line.label);
    if (!kind || line.count === 0) continue;
    events.push({ kind, count: Math.max(1, line.count) });
  }
  return events;
}

export function eventsFromAudit(player: AuditPlayer) {
  return eventsFromLines(player.lines);
}

export const LIVE_NOTE = "In diretta contano solo i titolari con voto. La panchina entra al calcolo della giornata, se un titolare resta senza voto. S.V. vuol dire senza voto, il trattino che il voto non è ancora arrivato.";

/**
 * Giornata appena iniziata: nessun titolare ha ancora un voto, quindi non c'è una classifica
 * da mostrare. Senza formazioni in diretta non si può dire, e vale falso.
 */
export function awaitingVotes(sheets: (LiveLineupSheet | undefined)[]) {
  const known = sheets.filter((sheet): sheet is LiveLineupSheet => Boolean(sheet));
  return known.length > 0 && known.every((sheet) => sheet.starters.every((row) => row.voto === null));
}

/** Le righe in diretta. In evidenza resta solo chi conta adesso: i titolari con voto. */
export function compactFromLive(sheet: LiveLineupSheet) {
  const map = (benched: boolean) => (row: LiveLineupSheet["starters"][number]): CompactPlayer => ({
    id: row.playerId,
    name: row.fullName,
    role: row.role,
    club: row.clubShort,
    vote: row.voto,
    fanta: row.fantavoto,
    captain: row.isCaptain,
    vice: row.isVice,
    emptyText: row.waiting ? "—" : "S.V.",
    played: !benched && row.voto != null,
    entered: false,
    events: row.events,
  });
  return { starters: sheet.starters.map(map(false)), bench: sheet.bench.map(map(true)) };
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
