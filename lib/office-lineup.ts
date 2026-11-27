import type { LeagueRules } from "@/lib/league-rules";

/**
 * I punti di giornata di una squadra in una lega, con le regole del calcolo finale per chi non ha salvato
 * (`fantasyPointsForLeague`): con la penalità, formazione d'ufficio o nessuna formazione valgono la penalità;
 * altrimenti contano i punti della formazione, anche d'ufficio. `null`: nessuna formazione e nessun punto.
 */
export function teamWeekPoints(
  rules: Pick<LeagueRules, "missedLineup" | "missedLineupPenalty">,
  team: { points: number | null; office: boolean },
): number | null {
  if (rules.missedLineup === "penalty" && (team.office || team.points === null)) return rules.missedLineupPenalty;
  return team.points;
}
