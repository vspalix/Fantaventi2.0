import { FORMATIONS, fitsFormation, type RoleCounts } from "@/lib/formations";
import type { PlayerRole } from "@/lib/types";

export class ScoreEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreEngineError";
  }
}

type CaptainBand = {
  max_exclusive?: number;
  eq?: number;
  min_inclusive?: number;
  points: number;
};

type DefenseBand = { min: number; points: number };

export type RulesetDefinition = {
  lineup_size?: number;
  double_captain_malus?: boolean;
  empty_slot_points?: number;
  captain_modifier?: CaptainBand[];
  captain_multiplier?: number;
  fair_play?: { points?: number; cards?: string[] };
  defense_modifier?: {
    enabled?: boolean;
    basis?: "voto" | "fantavoto";
    min_rated_defenders?: number;
    best_defenders?: number;
    bands?: DefenseBand[];
  };
  bonus_malus?: Record<string, number>;
  clean_sheet?: { enabled?: boolean; points?: number };
  postponement?: "political_six" | "wait_recovery";
};

export type PlayerStat = {
  playerId: string;
  role: PlayerRole;
  voto: number | null;
  goals?: number;
  assists?: number;
  yellowCards?: number;
  redCards?: number;
  penaltiesScored?: number;
  penaltiesMissed?: number;
  penaltiesSaved?: number;
  ownGoals?: number;
  goalsConceded?: number;
  postponed?: boolean;
  withoutVote?: boolean;
};

export type LineupSlotInput = {
  playerId: string;
  isCaptain: boolean;
  isVice: boolean;
  role?: PlayerRole;
  benchOrder?: number;
};

export type PlayerScore = {
  playerId: string;
  role: PlayerRole;
  voto: number | null;
  bonusPoints: number;
  malusPoints: number;
  malusFactor: number;
  playerPoints: number | null;
  isEffectiveCaptain: boolean;
  yellowCards: number;
  fantavoto: number | null;
};

export type TeamScore = {
  fantasyTeamId: string;
  playersPoints: number;
  captainModifier: number;
  captainPlayerId: string | null;
  fairPlay: number;
  defenseModifier: number;
  defenseAverage: number | null;
  reservePoints: number;
  total: number;
  players: PlayerScore[];
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function amount(catalog: Record<string, number>, key: string) {
  return catalog[key] ?? 0;
}

function cleanSheetBonus(role: PlayerRole, stat: PlayerStat | undefined, voto: number | null, definition: RulesetDefinition) {
  const config = definition.clean_sheet;
  if (!config?.enabled || role !== "GK" || voto === null) return 0;
  if ((stat?.goalsConceded ?? 0) > 0) return 0;
  return config.points ?? 0;
}

export function filedPlayerScore(
  stat: PlayerStat | undefined,
  role: PlayerRole,
  definition: RulesetDefinition,
  malusFactor = 1,
) {
  const political = stat?.voto == null && Boolean(stat?.postponed) && definition.postponement === "political_six";
  const voto = political ? 6 : (stat?.voto ?? null);
  if (voto === null) return { voto: null, bonus: null, malus: null, fantavoto: null };
  const catalog = definition.bonus_malus ?? {};
  const bonus = political ? 0 : round2(
    (stat?.goals ?? 0) * amount(catalog, "goal")
    + (stat?.assists ?? 0) * amount(catalog, "assist")
    + (stat?.penaltiesScored ?? 0) * amount(catalog, "penalty_scored")
    + (stat?.penaltiesSaved ?? 0) * amount(catalog, "penalty_saved")
    + cleanSheetBonus(role, stat, voto, definition),
  );
  const baseMalus = political ? 0 : round2(
    (stat?.yellowCards ?? 0) * amount(catalog, "yellow_card")
    + (stat?.redCards ?? 0) * amount(catalog, "red_card")
    + (stat?.penaltiesMissed ?? 0) * amount(catalog, "penalty_missed")
    + (stat?.ownGoals ?? 0) * amount(catalog, "own_goal")
    + (role === "GK" ? (stat?.goalsConceded ?? 0) * amount(catalog, "goal_conceded") : 0),
  );
  const malus = round2(baseMalus * malusFactor);
  return { voto, bonus, malus, fantavoto: round2(voto + bonus + malus) };
}

function captainModifierFor(vote: number, bands: CaptainBand[]) {
  for (const band of bands) {
    if (band.max_exclusive !== undefined && vote < band.max_exclusive) return band.points;
    if (band.eq !== undefined && vote === band.eq) return band.points;
    if (band.min_inclusive !== undefined && vote >= band.min_inclusive) return band.points;
  }
  throw new ScoreEngineError(
    `Voto capitano ${vote} fuori dalle fasce del ruleset. La giornata non viene pubblicata.`,
  );
}

function defenseModifierFor(average: number, bands: DefenseBand[]) {
  const ordered = [...bands].sort((a, b) => b.min - a.min);
  return ordered.find((band) => average >= band.min)?.points ?? 0;
}

function votoOf(stats: Map<string, PlayerStat>, playerId: string | undefined) {
  if (!playerId) return null;
  return stats.get(playerId)?.voto ?? null;
}

function roleOf(slot: LineupSlotInput, stats: Map<string, PlayerStat>) {
  return slot.role ?? stats.get(slot.playerId)?.role;
}

function emptyCounts(): RoleCounts {
  return { GK: 0, DEF: 0, MID: 0, FWD: 0 };
}

function moduleAllows(counts: RoleCounts) {
  return counts.GK >= 0
    && counts.DEF >= 0
    && counts.MID >= 0
    && counts.FWD >= 0
    && FORMATIONS.some((formation) => fitsFormation(counts, formation));
}

export type SubstitutionTrace = {
  starterId: string;
  outcome: "kept" | "same-role" | "module-switch" | "unfilled";
  entrantId: string | null;
  benchOrder: number | null;
};

export function playingEleven(
  slots: LineupSlotInput[],
  stats: Map<string, PlayerStat>,
  lineupSize: number,
  holeIds?: ReadonlySet<string>,
) {
  const starters = slots.filter((slot) => slot.benchOrder == null).slice(0, lineupSize);
  const bench = slots
    .filter((slot) => slot.benchOrder != null)
    .sort((left, right) => (left.benchOrder ?? 0) - (right.benchOrder ?? 0));
  const used = new Set<string>();
  const counts = emptyCounts();
  for (const starter of starters) {
    const role = roleOf(starter, stats);
    if (role) counts[role] += 1;
  }
  const xi: LineupSlotInput[] = [];
  const trace: SubstitutionTrace[] = [];
  let unfilledHoles = 0;

  for (const starter of starters) {
    const missingVote = votoOf(stats, starter.playerId) == null;
    const isHole = holeIds ? holeIds.has(starter.playerId) : missingVote;
    if (!isHole) {
      xi.push(starter);
      trace.push({ starterId: starter.playerId, outcome: "kept", entrantId: null, benchOrder: null });
      continue;
    }
    const role = roleOf(starter, stats);
    const same = role
      ? bench.find((candidate) => {
        if (used.has(candidate.playerId)) return false;
        if (roleOf(candidate, stats) !== role) return false;
        return votoOf(stats, candidate.playerId) != null;
      })
      : undefined;
    if (same) {
      used.add(same.playerId);
      xi.push({ ...same, isCaptain: false, isVice: false, benchOrder: undefined, role: roleOf(same, stats) });
      trace.push({
        starterId: starter.playerId,
        outcome: "same-role",
        entrantId: same.playerId,
        benchOrder: same.benchOrder ?? null,
      });
      continue;
    }
    const switched = role && role !== "GK"
      ? bench.find((candidate) => {
        if (used.has(candidate.playerId)) return false;
        const nextRole = roleOf(candidate, stats);
        if (!nextRole || nextRole === role || nextRole === "GK") return false;
        if (votoOf(stats, candidate.playerId) == null) return false;
        const next = { ...counts, [role]: counts[role] - 1, [nextRole]: counts[nextRole] + 1 };
        return moduleAllows(next);
      })
      : undefined;
    if (switched && role) {
      const nextRole = roleOf(switched, stats);
      if (nextRole) {
        counts[role] -= 1;
        counts[nextRole] += 1;
        used.add(switched.playerId);
        xi.push({ ...switched, isCaptain: false, isVice: false, benchOrder: undefined, role: nextRole });
        trace.push({
          starterId: starter.playerId,
          outcome: "module-switch",
          entrantId: switched.playerId,
          benchOrder: switched.benchOrder ?? null,
        });
        continue;
      }
    }
    if (role) counts[role] -= 1;
    unfilledHoles += 1;
    trace.push({ starterId: starter.playerId, outcome: "unfilled", entrantId: null, benchOrder: null });
  }

  return { starters, xi, unfilledHoles, trace };
}

export function scoreLineup(
  fantasyTeamId: string,
  slots: LineupSlotInput[],
  stats: Map<string, PlayerStat>,
  definition: RulesetDefinition,
  holeIds?: ReadonlySet<string>,
): TeamScore {
  const catalog = definition.bonus_malus ?? {};
  const lineupSize = definition.lineup_size ?? 11;
  const doubleMalus = definition.double_captain_malus !== false;
  const { starters, xi, unfilledHoles } = playingEleven(slots, stats, lineupSize, holeIds);

  const players: PlayerScore[] = xi.map((slot) => {
    const stat = stats.get(slot.playerId);
    const role = slot.role ?? stat?.role ?? "MID";
    const political = stat?.voto == null && Boolean(stat?.postponed) && definition.postponement === "political_six";
    const voto = political ? 6 : (stat?.voto ?? null);
    const bonus = voto === null || political ? 0 : round2(
      (stat?.goals ?? 0) * amount(catalog, "goal")
      + (stat?.assists ?? 0) * amount(catalog, "assist")
      + (stat?.penaltiesScored ?? 0) * amount(catalog, "penalty_scored")
      + (stat?.penaltiesSaved ?? 0) * amount(catalog, "penalty_saved")
      + cleanSheetBonus(role, stat, voto, definition),
    );
    const malus = voto === null || political ? 0 : round2(
      (stat?.yellowCards ?? 0) * amount(catalog, "yellow_card")
      + (stat?.redCards ?? 0) * amount(catalog, "red_card")
      + (stat?.penaltiesMissed ?? 0) * amount(catalog, "penalty_missed")
      + (stat?.ownGoals ?? 0) * amount(catalog, "own_goal")
      + (role === "GK" ? (stat?.goalsConceded ?? 0) * amount(catalog, "goal_conceded") : 0),
    );
    return {
      playerId: slot.playerId,
      role,
      voto,
      bonusPoints: bonus,
      malusPoints: malus,
      malusFactor: 1,
      playerPoints: null,
      isEffectiveCaptain: false,
      yellowCards: stat?.yellowCards ?? 0,
      fantavoto: voto === null ? null : round2(voto + bonus + malus),
    };
  });

  const byId = new Map(players.map((player) => [player.playerId, player]));
  const captain = starters.find((slot) => slot.isCaptain);
  const vice = starters.find((slot) => slot.isVice);
  const effectiveId = votoOf(stats, captain?.playerId) != null
    ? captain?.playerId
    : votoOf(stats, vice?.playerId) != null
      ? vice?.playerId
      : null;
  const effective = effectiveId ? byId.get(effectiveId) : undefined;

  if (effective && doubleMalus) {
    effective.isEffectiveCaptain = true;
    effective.malusFactor = 2;
  } else if (effective) {
    effective.isEffectiveCaptain = true;
  }

  for (const player of players) {
    if (player.voto === null) continue;
    player.playerPoints = round2(player.voto + player.bonusPoints + player.malusPoints * player.malusFactor);
  }

  const playersPoints = round2(
    players.reduce((sum, player) => sum + (player.playerPoints ?? 0), 0),
  );

  let captainBonus = 0;
  const multiplier = definition.captain_multiplier ?? 1;
  const captainStat = effective ? stats.get(effective.playerId) : undefined;
  const politicalCaptain = Boolean(
    captainStat?.voto == null && captainStat?.postponed && definition.postponement === "political_six",
  );
  if (!politicalCaptain && effective?.voto != null && multiplier === 1) {
    captainBonus = captainModifierFor(effective.voto, definition.captain_modifier ?? []);
  } else if (!politicalCaptain && effective?.playerPoints != null && multiplier !== 1) {
    captainBonus = round2(effective.playerPoints * (multiplier - 1));
  }

  const rated = players.filter((player) => player.voto !== null);
  const fairCards = new Set(definition.fair_play?.cards ?? ["yellow_card"]);
  const fairBroken = fairCards.has("yellow_card") && rated.some((player) => player.yellowCards > 0);
  const fairPlay = rated.length > 0 && !fairBroken ? (definition.fair_play?.points ?? 0) : 0;

  const defense = defenseScore(players, definition);
  const emptySlots = Math.max(lineupSize - starters.length, 0) + unfilledHoles;
  const reservePoints = round2((definition.empty_slot_points ?? 0) * emptySlots);
  const total = round2(playersPoints + captainBonus + fairPlay + defense.modifier + reservePoints);

  return {
    fantasyTeamId,
    playersPoints,
    captainModifier: round2(captainBonus),
    captainPlayerId: effective?.playerId ?? null,
    fairPlay: round2(fairPlay),
    defenseModifier: round2(defense.modifier),
    defenseAverage: defense.average === null ? null : round2(defense.average),
    reservePoints,
    total,
    players,
  };
}

export type DefenseBreakdown = {
  enabled: boolean;
  basis: "voto" | "fantavoto";
  minDefenders: number;
  best: number;
  keeperId: string | null;
  defenderIds: string[];
  chosenIds: string[];
  values: number[];
  average: number | null;
  modifier: number;
  reason: string;
};

export function defenseBreakdown(players: PlayerScore[], definition: RulesetDefinition): DefenseBreakdown {
  const config = definition.defense_modifier ?? {};
  const minDefenders = config.min_rated_defenders ?? 4;
  const best = config.best_defenders ?? 3;
  const basis = config.basis ?? "voto";
  const empty: DefenseBreakdown = {
    enabled: config.enabled !== false,
    basis,
    minDefenders,
    best,
    keeperId: null,
    defenderIds: [],
    chosenIds: [],
    values: [],
    average: null,
    modifier: 0,
    reason: "Modificatore difesa spento.",
  };
  if (config.enabled === false) return empty;
  const rating = (player: PlayerScore) => (basis === "fantavoto" ? (player.fantavoto ?? 0) : (player.voto ?? 0));
  const keeper = players.find((player) => player.role === "GK" && player.voto !== null);
  const defenders = players
    .filter((player) => player.role === "DEF" && player.voto !== null)
    .sort((a, b) => {
      if (rating(b) !== rating(a)) return rating(b) - rating(a);
      const fantaB = b.fantavoto ?? 0;
      const fantaA = a.fantavoto ?? 0;
      if (fantaB !== fantaA) return fantaB - fantaA;
      return a.playerId < b.playerId ? -1 : 1;
    });
  const base = {
    ...empty,
    keeperId: keeper?.playerId ?? null,
    defenderIds: defenders.map((player) => player.playerId),
  };
  if (!keeper) return { ...base, reason: "Manca un portiere con voto: difesa 0." };
  if (defenders.length < minDefenders) {
    return { ...base, reason: `Difensori con voto: ${defenders.length}. Ne servono ${minDefenders}: difesa 0.` };
  }
  const chosen = defenders.slice(0, best);
  const picked = [keeper, ...chosen];
  const values = picked.map((player) => rating(player));
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const modifier = defenseModifierFor(average, config.bands ?? []);
  return {
    ...base,
    chosenIds: picked.map((player) => player.playerId),
    values,
    average,
    modifier,
    reason: `Media ${basis} ${round2(average)} sui ${picked.length} valori. Bonus difesa ${round2(modifier)}.`,
  };
}

function defenseScore(players: PlayerScore[], definition: RulesetDefinition) {
  const detail = defenseBreakdown(players, definition);
  return { modifier: detail.modifier, average: detail.average };
}

export type ProvisionalScore = TeamScore & {
  gameweekId: string;
  provisionalTotal: number;
  ratedPlayersCount: number;
  onPitchCount: number;
};

export function provisionalContext(
  slots: LineupSlotInput[],
  stats: Map<string, PlayerStat>,
  definition: RulesetDefinition,
  matchFinished: ReadonlySet<string>,
) {
  const lineupSize = definition.lineup_size ?? 11;
  const starters = slots.filter((slot) => slot.benchOrder == null).slice(0, lineupSize);
  const holeIds = new Set<string>();
  let onPitchCount = 0;

  for (const slot of starters) {
    const stat = stats.get(slot.playerId);
    const hasVote = stat?.voto != null;
    const finished = matchFinished.has(slot.playerId);
    if (!hasVote && finished) holeIds.add(slot.playerId);
    if (!hasVote && !finished) onPitchCount += 1;
  }

  const captain = starters.find((slot) => slot.isCaptain);
  const captainStillPlaying = Boolean(
    captain && holeIds.has(captain.playerId) === false && (stats.get(captain.playerId)?.voto ?? null) == null,
  );
  const slotsForScore = captainStillPlaying
    ? slots.map((slot) => ({ ...slot, isCaptain: false, isVice: false }))
    : slots;
  return { lineupSize, holeIds, slotsForScore, onPitchCount, captainStillPlaying };
}

function plainStats(stats: Map<string, PlayerStat>) {
  const plain = new Map<string, PlayerStat>();
  for (const [id, stat] of stats) plain.set(id, { ...stat, postponed: false });
  return plain;
}

function neutralSlots(slots: LineupSlotInput[]) {
  return slots.map((slot) => ({ ...slot, isCaptain: false, isVice: false }));
}

export function liveHoleIds(
  slots: LineupSlotInput[],
  stats: Map<string, PlayerStat>,
  definition: RulesetDefinition,
) {
  const lineupSize = definition.lineup_size ?? 11;
  const holes = new Set<string>();
  for (const slot of slots.filter((item) => item.benchOrder == null).slice(0, lineupSize)) {
    if (stats.get(slot.playerId)?.withoutVote) holes.add(slot.playerId);
  }
  return holes;
}

export function liveFormula(voto: number | null, bonus: number, malus: number) {
  if (voto === null || (bonus === 0 && malus === 0)) return null;
  const piece = (value: number) => value.toLocaleString("it-IT", { maximumFractionDigits: 2 });
  const parts = [piece(voto)];
  if (bonus !== 0) parts.push(`${bonus > 0 ? "+" : "−"} ${piece(Math.abs(bonus))}`);
  if (malus !== 0) parts.push(`${malus > 0 ? "+" : "−"} ${piece(Math.abs(malus))}`);
  return `${parts.join(" ")} = ${piece(round2(voto + bonus + malus))}`;
}

export function projectLiveScore(
  fantasyTeamId: string,
  gameweekId: string,
  slots: LineupSlotInput[],
  stats: Map<string, PlayerStat>,
  definition: RulesetDefinition,
): ProvisionalScore {
  const plain = plainStats(stats);
  const lineupSize = definition.lineup_size ?? 11;
  const starters = slots.filter((slot) => slot.benchOrder == null).slice(0, lineupSize);
  const holeIds = new Set<string>();
  let onPitchCount = 0;
  for (const slot of starters) {
    const stat = plain.get(slot.playerId);
    if ((stat?.voto ?? null) == null) onPitchCount += 1;
  }
  const base = scoreLineup(fantasyTeamId, neutralSlots(slots), plain, definition, holeIds);
  const provisionalTotal = round2(base.playersPoints + base.reservePoints);
  return {
    ...base,
    captainModifier: 0,
    captainPlayerId: null,
    fairPlay: 0,
    defenseModifier: 0,
    defenseAverage: null,
    total: provisionalTotal,
    gameweekId,
    provisionalTotal,
    ratedPlayersCount: base.players.filter((player) => player.voto !== null).length,
    onPitchCount,
  };
}

export function calculateProvisional(
  fantasyTeamId: string,
  gameweekId: string,
  slots: LineupSlotInput[],
  stats: Map<string, PlayerStat>,
  definition: RulesetDefinition,
  matchFinished: ReadonlySet<string>,
): ProvisionalScore {
  const context = provisionalContext(slots, stats, definition, matchFinished);
  const { holeIds, slotsForScore, onPitchCount } = context;
  const base = scoreLineup(fantasyTeamId, slotsForScore, stats, definition, holeIds);
  const ratedPlayersCount = base.players.filter((player) => player.voto !== null).length;
  const fairPlay = onPitchCount === 0 ? base.fairPlay : 0;
  const provisionalTotal = round2(
    base.playersPoints + base.captainModifier + fairPlay + base.defenseModifier + base.reservePoints,
  );

  return {
    ...base,
    fairPlay,
    total: provisionalTotal,
    gameweekId,
    provisionalTotal,
    ratedPlayersCount,
    onPitchCount,
  };
}
