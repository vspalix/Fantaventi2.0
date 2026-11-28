// Bonus e malus che l'admin può cambiare a lega in corso «da una giornata in poi».
// I valori di prima restano scritti nelle impostazioni della lega, con l'ultima giornata in cui valgono.
import { BONUS_FIELDS, type BonusKey, type LeagueRules } from "@/lib/league-rules";

export type ScoringKey = BonusKey | "cleanSheet" | "captain" | "defense";

/** `points`: punti della voce; per il capitano è il moltiplicatore (1 = fascia sul voto). */
export type ScoringValue = { enabled: boolean; points: number };

/** La voce valeva così fino alla giornata `until` compresa. */
export type ScoringChange = ScoringValue & { key: ScoringKey; until: number };

export type ScoringApply = "from-now" | "all";

// Una funzione e non un elenco già pronto: questo file e `league-rules` si importano a vicenda.
export function scoringKeys(): ScoringKey[] {
  return [...BONUS_FIELDS.map((field) => field.key), "cleanSheet", "captain", "defense"];
}

export function scoringLabel(key: ScoringKey) {
  if (key === "cleanSheet") return "Imbattibilità portiere";
  if (key === "captain") return "Bonus capitano";
  if (key === "defense") return "Modificatore difesa";
  return BONUS_FIELDS.find((field) => field.key === key)?.label ?? key;
}

export function scoringValue(rules: LeagueRules, key: ScoringKey): ScoringValue {
  if (key === "cleanSheet") return { enabled: rules.cleanSheetEnabled, points: rules.cleanSheetPoints };
  if (key === "captain") return { enabled: rules.captainEnabled, points: rules.captainMultiplier };
  if (key === "defense") return { enabled: rules.defenseEnabled, points: 0 };
  return { enabled: rules.bonusEnabled[key] !== false, points: rules.bonusMalus[key] };
}

function withValue(rules: LeagueRules, key: ScoringKey, value: ScoringValue): LeagueRules {
  if (key === "cleanSheet") return { ...rules, cleanSheetEnabled: value.enabled, cleanSheetPoints: value.points };
  if (key === "captain") {
    const captainMultiplier = value.points === 1.5 || value.points === 2 ? value.points : 1;
    return { ...rules, captainEnabled: value.enabled, captainMultiplier };
  }
  if (key === "defense") return { ...rules, defenseEnabled: value.enabled };
  return {
    ...rules,
    bonusEnabled: { ...rules.bonusEnabled, [key]: value.enabled },
    bonusMalus: { ...rules.bonusMalus, [key]: value.points },
  };
}

/** Le regole con cui si calcola una giornata: quelle di oggi, salvo le voci che allora erano diverse. */
export function rulesAt(rules: LeagueRules, matchday: number): LeagueRules {
  let result = rules;
  for (const key of scoringKeys()) {
    // Lo storico è ordinato: vale il primo periodo che arriva almeno fino a questa giornata.
    const past = rules.scoringHistory.find((item) => item.key === key && item.until >= matchday);
    if (past) result = withValue(result, key, past);
  }
  return result;
}

/** Quanto conta davvero una voce: da spenta i suoi punti non cambiano niente. */
function effect(value: ScoringValue) {
  return value.enabled ? String(value.points) : "off";
}

export function changedScoring(before: LeagueRules, after: LeagueRules) {
  return scoringKeys().filter((key) => effect(scoringValue(before, key)) !== effect(scoringValue(after, key)));
}

function ordered(history: ScoringChange[]) {
  const keys = scoringKeys();
  return [...history].sort((left, right) => keys.indexOf(left.key) - keys.indexOf(right.key) || left.until - right.until);
}

/**
 * Lo storico dopo una modifica. «Da ora»: le giornate prima di `fromMatchday` tengono i valori che avevano.
 * «Tutte»: per le voci cambiate lo storico sparisce e il valore nuovo vale dall'inizio della lega.
 * Le voci non toccate restano com'erano.
 */
export function nextScoringHistory(current: LeagueRules, next: LeagueRules, apply: ScoringApply, fromMatchday: number) {
  const changed = new Set(changedScoring(current, next));
  const history = current.scoringHistory.filter((item) => !changed.has(item.key));
  if (apply === "all") return ordered(history);
  const last = fromMatchday - 1;
  for (const key of changed) {
    if (last < 1) continue;
    const own = current.scoringHistory.filter((item) => item.key === key);
    history.push(...own.filter((item) => item.until < last));
    const standing = own.find((item) => item.until >= last) ?? { ...scoringValue(current, key), key };
    history.push({ key, until: last, enabled: standing.enabled, points: standing.points });
  }
  return ordered(history);
}

export function parseScoringHistory(value: unknown): ScoringChange[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const keys = scoringKeys();
  const rows = value.flatMap((item): ScoringChange[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<ScoringChange>;
    const key = keys.find((candidate) => candidate === row.key);
    const until = Number(row.until);
    const points = Number(row.points);
    if (!key || !Number.isInteger(until) || until < 1 || !Number.isFinite(points) || typeof row.enabled !== "boolean") return [];
    if (seen.has(`${key}:${until}`)) return [];
    seen.add(`${key}:${until}`);
    return [{ key, until, enabled: row.enabled, points }];
  });
  return ordered(rows);
}

function valueText(key: ScoringKey, value: ScoringValue) {
  if (!value.enabled) return key === "cleanSheet" ? "spenta" : "spento";
  if (key === "defense") return "attivo";
  const number = value.points.toLocaleString("it-IT", { maximumFractionDigits: 2 });
  if (key === "captain") return value.points === 1 ? "fascia sul voto" : `×${number}`;
  return value.points > 0 ? `+${number}` : number;
}

/** Una riga per ogni periodo passato con valori diversi, per l'admin e per il regolamento. */
export function scoringHistoryLines(history: readonly ScoringChange[]) {
  return history.map((item, index) => {
    const previous = history[index - 1];
    const from = previous && previous.key === item.key ? previous.until + 1 : null;
    const span = from === null
      ? `fino alla giornata ${item.until}`
      : from === item.until ? `nella giornata ${item.until}` : `dalla giornata ${from} alla ${item.until}`;
    return `${scoringLabel(item.key)}: ${valueText(item.key, item)} ${span}`;
  });
}
