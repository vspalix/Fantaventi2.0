import { FORMATIONS } from "@/lib/formations";
import { BONUS_FIELDS, DEFAULT_LEAGUE_RULES } from "@/lib/league-rules";
import { buildOfficialRegulation } from "@/lib/rules/official-regulation";
import { MATCH_CLOSE_MS } from "@/lib/server/match-window";
import { DEFAULT_RULES } from "@/lib/types";

/** Valori di base del motore. Una lega può spegnere o cambiare formato, capitano, difesa e checkpoint. */
export const GAME_RULES = {
  squadSize: DEFAULT_RULES.squadSize,
  onePlayerPerClub: true,
  goalkeepers: { min: DEFAULT_RULES.gkMin, max: DEFAULT_RULES.gkMax },
  outfield: { min: DEFAULT_RULES.outfieldMin, max: DEFAULT_RULES.outfieldMax },
  lineupSize: 11,
  formations: FORMATIONS.map((formation) => formation.id),
  deadlineLeadMs: 60_000,
  matchCloseMs: MATCH_CLOSE_MS,
  emptySlotPoints: 2.5,
  fairPlayPoints: 2.5,
  bonus: BONUS_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    points: DEFAULT_LEAGUE_RULES.bonusMalus[field.key],
  })),
  checkpoints: DEFAULT_LEAGUE_RULES.checkpoints,
  defenseEnabled: DEFAULT_LEAGUE_RULES.defenseEnabled,
  captainMultiplier: DEFAULT_LEAGUE_RULES.captainMultiplier,
};

export function generalRegulationMarkdown() {
  return buildOfficialRegulation("Fantaventi", DEFAULT_LEAGUE_RULES);
}
