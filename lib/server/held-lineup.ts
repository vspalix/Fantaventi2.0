import type { LineupSlotInput, PlayerStat } from "@/lib/engine/calculator";
import type { PlayerRole } from "@/lib/types";

export type MatchHold = "none" | "postponed" | "suspended";

export function rowHold(row: { postponed?: boolean | null; hold_status?: string | null }): MatchHold {
  if (row.hold_status === "postponed" || row.hold_status === "suspended") return row.hold_status;
  return row.postponed ? "postponed" : "none";
}

export function isHeldMatch(row: { postponed?: boolean | null; hold_status?: string | null }) {
  return rowHold(row) !== "none";
}

/**
 * I calciatori di un club con la partita rinviata o sospesa restano senza voto, qualunque cosa
 * dica il tabellino. Classifica e dettaglio di squadra devono partire dagli stessi dati.
 */
export function holdPlayers(
  stats: Map<string, PlayerStat>,
  players: readonly { playerId: string; role?: PlayerRole }[],
  clubByPlayer: ReadonlyMap<string, string>,
  heldClubs: ReadonlySet<string> | undefined,
) {
  if (!heldClubs || heldClubs.size === 0) return;
  for (const player of players) {
    const clubId = clubByPlayer.get(player.playerId);
    if (!clubId || !heldClubs.has(clubId)) continue;
    stats.set(player.playerId, {
      playerId: player.playerId,
      role: player.role ?? stats.get(player.playerId)?.role ?? "MID",
      voto: null,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      penaltiesScored: 0,
      penaltiesMissed: 0,
      penaltiesSaved: 0,
      ownGoals: 0,
      goalsConceded: 0,
      postponed: true,
    });
  }
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
