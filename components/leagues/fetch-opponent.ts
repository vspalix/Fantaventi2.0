import type { OpponentLineup } from "@/lib/types";

/** La formazione di una sola squadra in una giornata: le leghe grandi le chiedono a richiesta. */
export async function fetchOpponent(leagueId: string, gameweekId: string, fantasyTeamId: string) {
  const query = new URLSearchParams({ view: "team", gameweek: gameweekId, team: fantasyTeamId });
  const response = await fetch(`/api/leagues/${leagueId}/hub?${query}`);
  const body = (await response.json()) as { opponent?: OpponentLineup; error?: string };
  if (!response.ok || !body.opponent) throw new Error(body.error ?? "Formazione non disponibile.");
  return body.opponent;
}
