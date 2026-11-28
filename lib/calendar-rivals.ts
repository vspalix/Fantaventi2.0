// Calendario Serie A: per ogni club, il calciatore che gli avversari di lega hanno più spesso in rosa.
// Codice senza dipendenze: gira anche nel browser.

/** Le rose delle altre squadre della lega. `team` è un numero qualsiasi: non dice di chi è la rosa. */
export type CalendarRivals = {
  players: { id: string; name: string; clubId: string }[];
  stints: { team: number; playerId: string; from: number; until: number | null }[];
};

export type ClubPick = {
  id: string;
  name: string;
  /** Su cento avversari con una rosa in quella giornata, quanti hanno questo calciatore. */
  percent: number;
  /** Altri calciatori dello stesso club con lo stesso numero di squadre. */
  ties: number;
};

/** Per club, il più scelto in quella giornata. A pari merito vale il primo in ordine alfabetico. */
export function rivalPicks(rivals: CalendarRivals, round: number): Map<string, ClubPick> {
  const withSquad = new Set<number>();
  const owners = new Map<string, Set<number>>();
  for (const stint of rivals.stints) {
    if (stint.from > round || (stint.until !== null && stint.until < round)) continue;
    withSquad.add(stint.team);
    const teams = owners.get(stint.playerId) ?? new Set<number>();
    teams.add(stint.team);
    owners.set(stint.playerId, teams);
  }

  const ranked = rivals.players
    .map((player) => ({ player, count: owners.get(player.id)?.size ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.player.name.localeCompare(right.player.name, "it"));

  const picks = new Map<string, ClubPick>();
  const best = new Map<string, number>();
  for (const { player, count } of ranked) {
    const pick = picks.get(player.clubId);
    if (!pick) {
      picks.set(player.clubId, { id: player.id, name: player.name, percent: Math.round((count / withSquad.size) * 100), ties: 0 });
      best.set(player.clubId, count);
    } else if (best.get(player.clubId) === count) {
      pick.ties += 1;
    }
  }
  return picks;
}
