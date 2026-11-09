import type { RulesetDefinition } from "@/lib/engine/calculator";

export const BONUS_FIELDS = [
  { key: "goal", label: "Gol", fallback: 3 },
  { key: "assist", label: "Assist", fallback: 1 },
  { key: "yellow_card", label: "Ammonizione", fallback: -0.5 },
  { key: "red_card", label: "Espulsione", fallback: -1 },
  { key: "penalty_scored", label: "Rigore segnato", fallback: 3 },
  { key: "penalty_missed", label: "Rigore sbagliato", fallback: -3 },
  { key: "penalty_saved", label: "Rigore parato", fallback: 3 },
  { key: "own_goal", label: "Autogol", fallback: -2 },
  { key: "goal_conceded", label: "Gol subito", fallback: -1 },
] as const;

export type BonusKey = (typeof BONUS_FIELDS)[number]["key"];

export type CompetitionFormat = "classic" | "h2h" | "hybrid";

export type GoalBand = {
  min: number;
  goals: number;
};

export const COMPETITION_FORMATS: { id: CompetitionFormat; label: string; detail: string }[] = [
  { id: "classic", label: "Classifica a somma", detail: "Ogni giornata somma i fantapunti. Nessuna conversione in gol." },
  { id: "h2h", label: "Scontri diretti", detail: "Calendario a coppie. I fantapunti diventano gol secondo le soglie della lega, poi 3, 1 o 0." },
  { id: "hybrid", label: "Fasi", detail: "Regular season a somma o scontri diretti, poi una fase finale a eliminazione. La coppa non entra nella classifica di regular season." },
];

export const DEFAULT_GOAL_BANDS: GoalBand[] = [
  { min: 66, goals: 1 },
  { min: 72, goals: 2 },
  { min: 78, goals: 3 },
  { min: 84, goals: 4 },
  { min: 90, goals: 5 },
  { min: 96, goals: 6 },
];

export type MarketCheckpoint = {
  afterMatchday: number;
  changes: number;
};

export type LeaguePhase = {
  kind: "regular" | "knockout";
  format: "classic" | "h2h";
  fromMatchday: number;
  toMatchday: number;
};

export type LeagueRules = {
  format: CompetitionFormat;
  ranking: "sum" | "head_to_head";
  visibility: "private" | "public";
  enrollment: "closed" | "open";
  maxMembers: number | null;
  defenseEnabled: boolean;
  captainEnabled: boolean;
  captainMultiplier: 1 | 1.5 | 2;
  missedLineup: "carry" | "penalty";
  missedLineupPenalty: number;
  cleanSheetEnabled: boolean;
  cleanSheetPoints: number;
  bonusEnabled: Record<BonusKey, boolean>;
  bonusMalus: Record<BonusKey, number>;
  budget: number;
  exclusiveRosters: boolean;
  checkpoints: MarketCheckpoint[];
  postponement: "political_six" | "wait_recovery";
  goalBands: GoalBand[];
  phases: LeaguePhase[];
};

export function defaultPhases(format: CompetitionFormat): LeaguePhase[] {
  if (format === "h2h") return [{ kind: "regular", format: "h2h", fromMatchday: 1, toMatchday: 38 }];
  if (format === "hybrid") {
    return [
      { kind: "regular", format: "classic", fromMatchday: 1, toMatchday: 30 },
      { kind: "knockout", format: "h2h", fromMatchday: 31, toMatchday: 38 },
    ];
  }
  return [{ kind: "regular", format: "classic", fromMatchday: 1, toMatchday: 38 }];
}

export const DEFAULT_LEAGUE_RULES: LeagueRules = {
  format: "classic",
  ranking: "sum",
  visibility: "private",
  enrollment: "open",
  maxMembers: null,
  defenseEnabled: true,
  captainEnabled: true,
  captainMultiplier: 1,
  missedLineup: "carry",
  missedLineupPenalty: 0,
  cleanSheetEnabled: false,
  cleanSheetPoints: 1,
  bonusEnabled: Object.fromEntries(BONUS_FIELDS.map((field) => [field.key, true])) as Record<BonusKey, boolean>,
  bonusMalus: Object.fromEntries(BONUS_FIELDS.map((field) => [field.key, field.fallback])) as Record<BonusKey, number>,
  phases: defaultPhases("classic"),
  budget: 0,
  exclusiveRosters: false,
  checkpoints: [],
  postponement: "wait_recovery",
  goalBands: DEFAULT_GOAL_BANDS.map((band) => ({ ...band })),
};

function captainMultiplierOf(value: unknown): 1 | 1.5 | 2 {
  const parsed = numberOr(value, 1);
  if (Math.abs(parsed - 1.5) < 0.001) return 1.5;
  if (Math.abs(parsed - 2) < 0.001) return 2;
  return 1;
}

export function officeLineupMode(modes: readonly ("carry" | "penalty")[]) {
  if (modes.length === 0 || modes.some((mode) => mode === "carry")) return "carry" as const;
  return "penalty" as const;
}

function numberOr(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatOf(source: { format?: unknown; ranking?: unknown }): CompetitionFormat {
  if (source.format === "classic" || source.format === "h2h" || source.format === "hybrid") return source.format;
  return source.ranking === "head_to_head" ? "h2h" : "classic";
}

function goalBandsOf(value: unknown): GoalBand[] {
  if (!Array.isArray(value)) return DEFAULT_GOAL_BANDS.map((band) => ({ ...band }));
  const bands = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { min?: unknown; goals?: unknown };
    const min = numberOr(row.min, Number.NaN);
    const goals = numberOr(row.goals, Number.NaN);
    if (!Number.isFinite(min) || !Number.isFinite(goals)) return [];
    return [{ min, goals: Math.max(0, Math.trunc(goals)) }];
  });
  return bands.sort((left, right) => left.min - right.min);
}

function checkpointsOf(value: unknown): MarketCheckpoint[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap((item): MarketCheckpoint[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as { afterMatchday?: unknown; changes?: unknown };
    const afterMatchday = Math.trunc(numberOr(row.afterMatchday, Number.NaN));
    const changes = Math.trunc(numberOr(row.changes, Number.NaN));
    if (afterMatchday < 1 || changes < 1 || seen.has(afterMatchday)) return [];
    seen.add(afterMatchday);
    return [{ afterMatchday, changes }];
  }).sort((left, right) => left.afterMatchday - right.afterMatchday);
}

export function openCheckpoint(checkpoints: readonly MarketCheckpoint[], closedMatchdays: readonly number[]) {
  const closed = new Set(closedMatchdays);
  return checkpoints.find((item) => closed.has(item.afterMatchday) && !closed.has(item.afterMatchday + 1)) ?? null;
}

export function rosterChangeCount(before: readonly string[], after: readonly string[]) {
  const next = new Set(after);
  let leaving = 0;
  for (const playerId of new Set(before)) {
    if (!next.has(playerId)) leaving += 1;
  }
  return leaving;
}

export function sharedPlayerIds(playerIds: readonly string[], otherRosters: readonly (readonly string[])[]) {
  const taken = new Set(otherRosters.flat());
  return [...new Set(playerIds)].filter((playerId) => taken.has(playerId));
}

export function lineupAcceptsUpdate(now: number, deadline: number, status: string) {
  if (status === "locked" || status === "scored" || status === "final") return false;
  return now < deadline;
}

function phasesOf(format: CompetitionFormat, value: unknown): LeaguePhase[] {
  if (format !== "hybrid") return defaultPhases(format);
  if (!Array.isArray(value)) return defaultPhases("hybrid");
  const phases = value.flatMap((item): LeaguePhase[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<LeaguePhase>;
    const kind = row.kind === "knockout" ? "knockout" : row.kind === "regular" ? "regular" : null;
    const phaseFormat = row.format === "h2h" ? "h2h" : row.format === "classic" ? "classic" : null;
    const fromMatchday = Math.trunc(numberOr(row.fromMatchday, Number.NaN));
    const toMatchday = Math.trunc(numberOr(row.toMatchday, Number.NaN));
    if (!kind || !phaseFormat || fromMatchday < 1 || toMatchday < fromMatchday) return [];
    return [{ kind, format: kind === "knockout" ? "h2h" : phaseFormat, fromMatchday, toMatchday }];
  });
  if (!phases.some((phase) => phase.kind === "regular")) return defaultPhases("hybrid");
  return phases.slice(0, 4);
}

export function scoringPhase(rules: Pick<LeagueRules, "phases">, matchday: number): LeaguePhase {
  return rules.phases.find((phase) => matchday >= phase.fromMatchday && matchday <= phase.toMatchday)
    ?? rules.phases[0]
    ?? defaultPhases("classic")[0];
}

export function weekScoreMode(rules: Pick<LeagueRules, "phases">, matchday: number): "sum" | "head_to_head" | "knockout" {
  const phase = scoringPhase(rules, matchday);
  if (phase.kind === "knockout") return "knockout";
  return phase.format === "h2h" ? "head_to_head" : "sum";
}

export function parseLeagueRules(value: unknown, formatOverride?: unknown): LeagueRules {
  const source = value && typeof value === "object" ? value as Partial<LeagueRules> & { bonusMalus?: Record<string, unknown> } : {};
  const bonusMalus = { ...DEFAULT_LEAGUE_RULES.bonusMalus };
  const bonusEnabled = { ...DEFAULT_LEAGUE_RULES.bonusEnabled };
  const enabledSource = source.bonusEnabled as Partial<Record<BonusKey, unknown>> | undefined;
  for (const field of BONUS_FIELDS) {
    if (source.bonusMalus && source.bonusMalus[field.key] != null) {
      bonusMalus[field.key] = numberOr(source.bonusMalus[field.key], field.fallback);
    }
    if (enabledSource && enabledSource[field.key] != null) bonusEnabled[field.key] = enabledSource[field.key] !== false;
  }
  const format = formatOf({ format: formatOverride ?? source.format, ranking: source.ranking });
  const visibility = source.visibility === "public" ? "public" : "private";
  const enrollment = source.enrollment === "closed" ? "closed" : "open";
  const maxMembers = enrollment === "closed"
    ? Math.max(2, Math.trunc(numberOr(source.maxMembers, 8)))
    : null;
  return {
    format,
    ranking: format === "h2h" ? "head_to_head" : "sum",
    visibility,
    enrollment,
    maxMembers,
    defenseEnabled: source.defenseEnabled !== false,
    captainEnabled: source.captainEnabled !== false,
    captainMultiplier: captainMultiplierOf(source.captainMultiplier),
    missedLineup: source.missedLineup === "penalty" ? "penalty" : "carry",
    missedLineupPenalty: numberOr(source.missedLineupPenalty, 0),
    cleanSheetEnabled: source.cleanSheetEnabled === true,
    cleanSheetPoints: Math.max(0, numberOr(source.cleanSheetPoints, DEFAULT_LEAGUE_RULES.cleanSheetPoints)),
    bonusEnabled,
    bonusMalus,
    budget: 0,
    exclusiveRosters: source.exclusiveRosters === true,
    checkpoints: checkpointsOf(source.checkpoints),
    postponement: source.postponement === "political_six" ? "political_six" : "wait_recovery",
    goalBands: goalBandsOf(source.goalBands),
    phases: phasesOf(format, source.phases),
  };
}

export function fantapuntiToGoals(points: number, bands: readonly GoalBand[]) {
  const ordered = [...bands].sort((left, right) => right.min - left.min);
  return ordered.find((band) => points >= band.min)?.goals ?? 0;
}

export function applyLeagueRules(definition: RulesetDefinition, rules: LeagueRules): RulesetDefinition {
  const defense = definition.defense_modifier;
  const bonusMalus = { ...definition.bonus_malus };
  for (const field of BONUS_FIELDS) {
    bonusMalus[field.key] = rules.bonusEnabled[field.key] === false ? 0 : rules.bonusMalus[field.key];
  }
  return {
    ...definition,
    bonus_malus: bonusMalus,
    postponement: rules.postponement,
    captain_modifier: rules.captainEnabled && rules.captainMultiplier === 1
      ? definition.captain_modifier
      : [{ min_inclusive: 0, points: 0 }],
    captain_multiplier: rules.captainEnabled ? rules.captainMultiplier : 1,
    clean_sheet: {
      enabled: rules.cleanSheetEnabled,
      points: rules.cleanSheetPoints,
    },
    defense_modifier: defense
      ? { ...defense, enabled: rules.defenseEnabled && defense.enabled !== false }
      : rules.defenseEnabled
        ? { enabled: true, basis: "voto", min_rated_defenders: 4, best_defenders: 3, bands: [
          { min: 6, points: 1 },
          { min: 6.5, points: 3 },
          { min: 7, points: 6 },
        ] }
        : { enabled: false, bands: [] },
  };
}

export function headToHeadPairings(teamIds: string[], weekNumber: number) {
  const ids = [...teamIds].sort();
  if (ids.length === 0) return { pairs: [] as { home: string; away: string }[], bye: null as string | null };
  const shift = (Math.max(1, weekNumber) - 1) % ids.length;
  const rotated = ids.slice(shift).concat(ids.slice(0, shift));
  const pairs: { home: string; away: string }[] = [];
  const pairCount = Math.floor(rotated.length / 2);
  for (let index = 0; index < pairCount; index += 1) {
    pairs.push({ home: rotated[index * 2], away: rotated[index * 2 + 1] });
  }
  const bye = rotated.length % 2 === 1 ? rotated[rotated.length - 1] : null;
  return { pairs, bye };
}

export function headToHeadPoints(
  teamIds: string[],
  weekNumber: number,
  fantasyPoints: Map<string, number>,
  goalBands?: readonly GoalBand[],
) {
  const awarded = new Map<string, number>();
  const { pairs, bye } = headToHeadPairings(teamIds, weekNumber);
  const scoreOf = (teamId: string) => {
    const points = fantasyPoints.get(teamId) ?? 0;
    return goalBands && goalBands.length > 0 ? fantapuntiToGoals(points, goalBands) : points;
  };
  for (const pair of pairs) {
    const homePoints = scoreOf(pair.home);
    const awayPoints = scoreOf(pair.away);
    if (homePoints === awayPoints) {
      awarded.set(pair.home, 1);
      awarded.set(pair.away, 1);
    } else if (homePoints > awayPoints) {
      awarded.set(pair.home, 3);
      awarded.set(pair.away, 0);
    } else {
      awarded.set(pair.home, 0);
      awarded.set(pair.away, 3);
    }
  }
  if (bye) awarded.set(bye, 3);
  return awarded;
}
