import type { PlayerStat } from "@/lib/engine/calculator";

/**
 * I calciatori il cui club ha già i voti: per loro un voto mancante è un «senza voto».
 * Una partita rinviata non conta, perché i suoi voti non ci sono ancora.
 */
export function playersWithVotesRead(
  stats: ReadonlyMap<string, PlayerStat>,
  clubByPlayer: ReadonlyMap<string, string>,
) {
  const clubs = new Set<string>();
  for (const [playerId, stat] of stats) {
    if (stat.postponed) continue;
    const clubId = clubByPlayer.get(playerId);
    if (clubId) clubs.add(clubId);
  }
  const players = new Set<string>();
  for (const [playerId, clubId] of clubByPlayer) {
    if (clubs.has(clubId)) players.add(playerId);
  }
  return players;
}
