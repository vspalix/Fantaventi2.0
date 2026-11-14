import type { LineupSlotInput, PlayerStat } from "@/lib/engine/calculator";

export type MatchHold = "none" | "postponed" | "suspended";

export function rowHold(row: { postponed?: boolean | null; hold_status?: string | null }): MatchHold {
  if (row.hold_status === "postponed" || row.hold_status === "suspended") return row.hold_status;
  return row.postponed ? "postponed" : "none";
}

export function isHeldMatch(row: { postponed?: boolean | null; hold_status?: string | null }) {
  return rowHold(row) !== "none";
}

export function holeIdsKeepingHeldPlayers(
  slots: LineupSlotInput[],
  stats: Map<string, PlayerStat>,
  lineupSize = 11,
) {
  const holes = new Set<string>();
  for (const slot of slots.filter((item) => item.benchOrder == null).slice(0, lineupSize)) {
    const stat = stats.get(slot.playerId);
    if (stat?.postponed && (stat.voto ?? null) == null) continue;
    if ((stat?.voto ?? null) == null) holes.add(slot.playerId);
  }
  return holes;
}
