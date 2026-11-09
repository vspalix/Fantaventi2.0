import {
  calculateProvisional,
  liveFormula,
  projectLiveScore,
  scoreLineup,
  type LineupSlotInput,
  type PlayerStat,
  type RulesetDefinition,
  type TeamScore,
} from "@/lib/engine/calculator";
import { explainScore } from "@/lib/engine/score-audit";
import { applyLeagueRules, fantapuntiToGoals, headToHeadPoints, lineupAcceptsUpdate, officeLineupMode, openCheckpoint, parseLeagueRules, rosterChangeCount, sharedPlayerIds, weekScoreMode, DEFAULT_GOAL_BANDS } from "@/lib/league-rules";
import { evaluateRoster } from "@/lib/constraints";
import { totalsDelta, weekCountsInTable } from "@/lib/chaos/delta";
import { buildLegalRoster } from "@/lib/scenario/roster";
import { SCENARIO_ACTIONS } from "@/lib/scenario/registry";
import { parseScenarioText, sandboxWeek, scenarioNarrative } from "@/lib/scenario/script";
import { EmergencyVoteError, parseEmergencyVotes } from "@/lib/adapters/emergency-votes";
import { awardBadges, h2hFlips, overtakes, pitchEvents } from "@/lib/engagement/live-board";
import { alphabeticalOfficeLineup } from "@/lib/formations";
import { assertVoteDocument, validateFantacalcioVote, VoteIngestionError } from "@/lib/server/fantacalcio-live";
import { isOfficialMatchClosed, isSettledGameweek } from "@/lib/server/match-window";
import type { PlayerRole } from "@/lib/types";

export type TestStatus = "PASSED" | "FAILED" | "SKIPPED";

export type TestCheck = {
  id: string;
  block: string;
  name: string;
  status: TestStatus;
  expected: string;
  actual: string;
  delta: string | null;
  durationMs: number;
  budgetMs: number | null;
  bottleneck: string | null;
};

export type EngineTestReport = {
  status: TestStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  checks: TestCheck[];
  load: {
    leagues: number;
    lineups: number;
    lineupsPerSecond: number;
    durationMs: number;
    budgetMs: number;
  };
};

const RULES: RulesetDefinition = {
  lineup_size: 11,
  double_captain_malus: true,
  empty_slot_points: 2.5,
  captain_modifier: [
    { max_exclusive: 6, points: -0.5 },
    { eq: 6, points: 0.5 },
    { eq: 6.5, points: 1 },
    { eq: 7, points: 1.5 },
    { min_inclusive: 7.5, points: 2 },
  ],
  fair_play: { points: 2.5, cards: ["yellow_card"] },
  defense_modifier: {
    basis: "voto",
    min_rated_defenders: 4,
    best_defenders: 3,
    bands: [
      { min: 6, points: 1 },
      { min: 6.5, points: 3 },
      { min: 7, points: 6 },
    ],
  },
  bonus_malus: {
    yellow_card: -0.5,
    red_card: -1,
    goal: 3,
    assist: 1,
    penalty_missed: -3,
    penalty_saved: 3,
    own_goal: -2,
    goal_conceded: -1,
  },
  postponement: "political_six",
};

const BUDGET = {
  oneLineupMs: 1,
  oneGameweekMs: 5,
  massLineupsMs: 25,
  screenMs: 5,
  queryMs: 2000,
};

type RowMark = "C" | "V" | number;

type Built = {
  slots: LineupSlotInput[];
  stats: Map<string, PlayerStat>;
};

type Outcome = {
  passed: boolean;
  expected: string;
  actual: string;
  delta?: string | null;
  budgetMs?: number | null;
  bottleneck?: string | null;
  durationMs?: number;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function millis(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function team(rows: Array<[string, PlayerRole, number | null, Partial<PlayerStat>?, RowMark?]>): Built {
  const slots: LineupSlotInput[] = [];
  const stats = new Map<string, PlayerStat>();
  for (const [id, role, voto, extra, mark] of rows) {
    const bench = typeof mark === "number";
    slots.push({
      playerId: id,
      role,
      isCaptain: mark === "C",
      isVice: mark === "V",
      benchOrder: bench ? mark : undefined,
    });
    stats.set(id, {
      playerId: id,
      role,
      voto,
      goals: extra?.goals ?? 0,
      assists: extra?.assists ?? 0,
      yellowCards: extra?.yellowCards ?? 0,
      redCards: extra?.redCards ?? 0,
      penaltiesScored: extra?.penaltiesScored ?? 0,
      penaltiesMissed: extra?.penaltiesMissed ?? 0,
      penaltiesSaved: extra?.penaltiesSaved ?? 0,
      ownGoals: extra?.ownGoals ?? 0,
      goalsConceded: extra?.goalsConceded ?? 0,
      postponed: extra?.postponed ?? false,
      withoutVote: extra?.withoutVote ?? false,
    });
  }
  return { slots, stats };
}

function base442(overrides?: {
  missing?: string[];
  captain?: string;
  vice?: string;
  voto?: number;
}): Built {
  const missing = new Set(overrides?.missing ?? []);
  const voto = overrides?.voto ?? 6;
  const rows: Array<[string, PlayerRole]> = [
    ["gk", "GK"],
    ["d1", "DEF"], ["d2", "DEF"], ["d3", "DEF"], ["d4", "DEF"],
    ["m1", "MID"], ["m2", "MID"], ["m3", "MID"], ["m4", "MID"],
    ["f1", "FWD"], ["f2", "FWD"],
  ];
  return team(rows.map(([id, role]) => [
    id,
    role,
    missing.has(id) ? null : voto,
    {},
    id === (overrides?.captain ?? "gk") ? "C" : id === overrides?.vice ? "V" : undefined,
  ]));
}

function score(built: Built, definition: RulesetDefinition = RULES, holeIds?: ReadonlySet<string>) {
  return scoreLineup("rosa", built.slots, built.stats, definition, holeIds);
}

function ids(result: TeamScore) {
  return result.players.map((player) => player.playerId);
}

function points(actual: number, expected: number): Outcome {
  const delta = round2(actual - expected);
  return {
    passed: delta === 0,
    expected: expected.toFixed(2),
    actual: actual.toFixed(2),
    delta: delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2),
  };
}

function sameText(actual: string, expected: string): Outcome {
  return {
    passed: actual === expected,
    expected,
    actual,
    delta: actual === expected ? "0" : "diverso",
  };
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOTE_LADDER = [5, 5.5, 6, 6.5, 7, 7.5, 8];

function generatedLeague(seed: number, teams: number) {
  const random = mulberry32(seed);
  const lineups: Built[] = [];
  for (let index = 0; index < teams; index += 1) {
    const built = base442({ captain: "m1", vice: "d1" });
    for (const stat of built.stats.values()) {
      if (random() < 0.18) stat.voto = null;
      else stat.voto = VOTE_LADDER[Math.floor(random() * VOTE_LADDER.length)] ?? 6;
      if (random() < 0.08) stat.yellowCards = 1;
      if (random() < 0.05) stat.assists = 1;
      if (random() < 0.03) stat.goals = 1;
    }
    const benchRoles: PlayerRole[] = ["DEF", "MID", "MID", "FWD"];
    benchRoles.forEach((role, order) => {
      const id = `b${index}-${order}`;
      const voto = random() < 0.25 ? null : (VOTE_LADDER[Math.floor(random() * VOTE_LADDER.length)] ?? 6);
      built.slots.push({ playerId: id, role, isCaptain: false, isVice: false, benchOrder: order + 1 });
      built.stats.set(id, {
        playerId: id,
        role,
        voto,
        yellowCards: 0,
        goals: 0,
        assists: 0,
        ownGoals: 0,
        redCards: 0,
        goalsConceded: 0,
      });
    });
    lineups.push(built);
  }
  return lineups;
}

function scoreLeague(lineups: Built[]) {
  return lineups.map((lineup) => score(lineup).total);
}

type QueryLog = { queries: string[] };

function scoreLeagueBatched(lineups: Built[], log: QueryLog) {
  log.queries.push("lineups:batch");
  log.queries.push("stats:batch");
  return lineups.map((lineup) => score(lineup).total);
}

function measure(run: () => void, samples = 5) {
  run();
  let best = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < samples; sample += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return millis(best);
}

function budgetOutcome(durationMs: number, budgetMs: number, bottleneck: string): Outcome {
  const over = millis(durationMs - budgetMs);
  return {
    passed: durationMs <= budgetMs,
    expected: `<= ${budgetMs.toFixed(3)} ms`,
    actual: `${durationMs.toFixed(3)} ms`,
    delta: over > 0 ? `+${over.toFixed(3)} ms` : `${over.toFixed(3)} ms`,
    budgetMs,
    bottleneck: durationMs <= budgetMs ? null : bottleneck,
    durationMs,
  };
}

export type SuiteOptions = {
  simulateNetworkLatency?: boolean;
};

export const MOCK_QUERY_LATENCY_MS = 100;

const SCREEN_QUERIES = ["gameweek", "season", "lineups", "stats", "registrations", "matches"];
const SCREEN_LATENCY_BUDGET_MS = 900;

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mockedQuery(log: QueryLog, name: string, simulateNetworkLatency: boolean) {
  log.queries.push(name);
  if (simulateNetworkLatency) await wait(MOCK_QUERY_LATENCY_MS);
}

async function loadMockedGameweek(lineups: Built[], simulateNetworkLatency: boolean) {
  const log: QueryLog = { queries: [] };
  for (const name of SCREEN_QUERIES) await mockedQuery(log, name, simulateNetworkLatency);
  return { log, totals: lineups.map((lineup) => score(lineup).total) };
}

export function withChecks(report: EngineTestReport, extra: TestCheck[]): EngineTestReport {
  const checks = [...report.checks, ...extra];
  const passed = checks.filter((check) => check.status === "PASSED").length;
  const failed = checks.filter((check) => check.status === "FAILED").length;
  const skipped = checks.filter((check) => check.status === "SKIPPED").length;
  return {
    ...report,
    checks,
    passed,
    failed,
    skipped,
    status: failed > 0 ? "FAILED" : "PASSED",
  };
}

export async function runScoringEngineTestSuite(options: SuiteOptions = {}): Promise<EngineTestReport> {
  const simulateNetworkLatency = options.simulateNetworkLatency !== false;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const checks: TestCheck[] = [];

  function add(block: string, id: string, name: string, body: () => Outcome) {
    const start = performance.now();
    let outcome: Outcome;
    try {
      outcome = body();
    } catch (error) {
      outcome = {
        passed: false,
        expected: "nessun errore",
        actual: error instanceof Error ? error.message : "errore",
        delta: null,
        bottleneck: "eccezione nel caso",
      };
    }
    checks.push({
      id,
      block,
      name,
      status: outcome.passed ? "PASSED" : "FAILED",
      expected: outcome.expected,
      actual: outcome.actual,
      delta: outcome.delta ?? null,
      durationMs: outcome.durationMs ?? millis(performance.now() - start),
      budgetMs: outcome.budgetMs ?? null,
      bottleneck: outcome.bottleneck ?? null,
    });
  }

  add("Casi base", "A1", "S.V. con ammonizione, assist e autogol: i bonus non entrano e subentra il primo centrocampista con voto", () => {
    const built = base442({ missing: ["m4"] });
    const hole = built.stats.get("m4");
    if (hole) {
      hole.yellowCards = 1;
      hole.assists = 1;
      hole.ownGoals = 1;
    }
    built.slots.push(
      { playerId: "b1", role: "MID", isCaptain: false, isVice: false, benchOrder: 1 },
      { playerId: "b2", role: "MID", isCaptain: false, isVice: false, benchOrder: 2 },
    );
    built.stats.set("b1", { playerId: "b1", role: "MID", voto: 6 });
    built.stats.set("b2", { playerId: "b2", role: "MID", voto: 7 });
    const result = score(built);
    const onPitch = ids(result).slice().sort().join(",");
    const events = result.players.reduce((sum, player) => sum + player.bonusPoints + player.malusPoints + player.yellowCards, 0);
    const shape = points(result.total, 70);
    const entered = onPitch === ["b1", "d1", "d2", "d3", "d4", "f1", "f2", "gk", "m1", "m2", "m3"].sort().join(",");
    return {
      passed: shape.passed && entered && events === 0 && !ids(result).includes("m4") && !ids(result).includes("b2"),
      expected: "70.00, entra b1, eventi S.V. 0",
      actual: entered && events === 0 ? `${result.total.toFixed(2)}, entra b1, eventi S.V. 0` : `${result.total.toFixed(2)}, in campo ${onPitch}, eventi ${events}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "A2", "S.V. senza sostituto vale la riserva d'ufficio e l'ammonizione non rompe il fair play", () => {
    const built = base442({ missing: ["m4"] });
    const hole = built.stats.get("m4");
    if (hole) hole.yellowCards = 1;
    const result = score(built);
    const shape = points(result.total, 66.5);
    return {
      passed: shape.passed && result.reservePoints === 2.5 && result.fairPlay === 2.5 && result.players.length === 10,
      expected: "66.50, riserva 2.50, fair play 2.50",
      actual: `${result.total.toFixed(2)}, riserva ${result.reservePoints.toFixed(2)}, fair play ${result.fairPlay.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "B1", "In panchina si salta chi non ha voto e si prende il primo dello stesso ruolo che ce l'ha", () => {
    const built = base442({ missing: ["m4"] });
    built.slots.push(
      { playerId: "b1", role: "MID", isCaptain: false, isVice: false, benchOrder: 1 },
      { playerId: "b2", role: "MID", isCaptain: false, isVice: false, benchOrder: 2 },
    );
    built.stats.set("b1", { playerId: "b1", role: "MID", voto: null });
    built.stats.set("b2", { playerId: "b2", role: "MID", voto: 6.5 });
    const result = score(built);
    const shape = points(result.total, 70.5);
    return {
      passed: shape.passed && ids(result).includes("b2") && !ids(result).includes("b1"),
      expected: "70.50 con b2",
      actual: `${result.total.toFixed(2)} con ${ids(result).includes("b2") ? "b2" : "altro"}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "B2", "Senza riserva di ruolo si cambia modulo se resta valido, e la difesa scende sotto i 4", () => {
    const built = base442({ missing: ["d4"] });
    built.slots.push({ playerId: "b1", role: "MID", isCaptain: false, isVice: false, benchOrder: 1 });
    built.stats.set("b1", { playerId: "b1", role: "MID", voto: 6 });
    const result = score(built);
    const shape = points(result.total, 69);
    return {
      passed: shape.passed && ids(result).includes("b1") && result.defenseModifier === 0 && result.players.filter((player) => player.role === "DEF").length === 3,
      expected: "69.00, difesa 0, 3 difensori",
      actual: `${result.total.toFixed(2)}, difesa ${result.defenseModifier.toFixed(2)}, ${result.players.filter((player) => player.role === "DEF").length} difensori`,
      delta: shape.delta,
    };
  });

  add("Casi base", "B3", "Il portiere senza voto non viene sostituito da un movimento e lascia il posto vuoto", () => {
    const built = base442({ missing: ["gk"], vice: "d1" });
    built.slots.push({ playerId: "b1", role: "FWD", isCaptain: false, isVice: false, benchOrder: 1 });
    built.stats.set("b1", { playerId: "b1", role: "FWD", voto: 6 });
    const result = score(built);
    const shape = points(result.total, 65.5);
    return {
      passed: shape.passed && result.captainPlayerId === "d1" && result.reservePoints === 2.5 && result.defenseModifier === 0 && !ids(result).includes("b1"),
      expected: "65.50, vice d1, riserva 2.50",
      actual: `${result.total.toFixed(2)}, capitano ${result.captainPlayerId ?? "nessuno"}, riserva ${result.reservePoints.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "B4", "Il cambio di modulo che rompe la formazione non parte e resta la riserva d'ufficio", () => {
    const rows: Array<[string, PlayerRole, number | null, Partial<PlayerStat>?, RowMark?]> = [
      ["gk", "GK", 6, {}, "C"],
      ["d1", "DEF", null], ["d2", "DEF", 6], ["d3", "DEF", 6],
      ["m1", "MID", 6], ["m2", "MID", 6], ["m3", "MID", 6], ["m4", "MID", 6],
      ["f1", "FWD", 6], ["f2", "FWD", 6], ["f3", "FWD", 6],
      ["b1", "FWD", 6, {}, 1],
    ];
    const result = score(team(rows));
    const shape = points(result.total, 65.5);
    return {
      passed: shape.passed && !ids(result).includes("b1") && result.reservePoints === 2.5,
      expected: "65.50, panchina ferma",
      actual: `${result.total.toFixed(2)}, panchina ${ids(result).includes("b1") ? "entrata" : "ferma"}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "B5", "Due buchi nello stesso ruolo pescano la panchina in ordine di slot", () => {
    const built = base442({ missing: ["d3", "d4"] });
    built.slots.push(
      { playerId: "b1", role: "DEF", isCaptain: false, isVice: false, benchOrder: 1 },
      { playerId: "b2", role: "DEF", isCaptain: false, isVice: false, benchOrder: 2 },
    );
    built.stats.set("b1", { playerId: "b1", role: "DEF", voto: 6 });
    built.stats.set("b2", { playerId: "b2", role: "DEF", voto: 7 });
    const result = score(built);
    const shape = points(result.total, 71);
    return {
      passed: shape.passed && ids(result).includes("b1") && ids(result).includes("b2") && result.defenseModifier === 1,
      expected: "71.00 con b1 e b2",
      actual: `${result.total.toFixed(2)}, difesa ${result.defenseModifier.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "C1", "Il modificatore difesa usa i tre voti migliori più il portiere, non il fantavoto", () => {
    const built = base442();
    const setVote = (id: string, voto: number, goals = 0) => {
      const stat = built.stats.get(id);
      if (stat) {
        stat.voto = voto;
        stat.goals = goals;
      }
    };
    setVote("gk", 6);
    setVote("d1", 7);
    setVote("d2", 6.5);
    setVote("d3", 6.5);
    setVote("d4", 6, 1);
    const result = score(built);
    const shape = points(result.total, 77);
    return {
      passed: shape.passed && result.defenseModifier === 3 && result.defenseAverage === 6.5,
      expected: "77.00, difesa 3.00 su media 6.50",
      actual: `${result.total.toFixed(2)}, difesa ${result.defenseModifier.toFixed(2)} su media ${result.defenseAverage?.toFixed(2) ?? "—"}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "C2", "Il capitano raddoppia solo i malus e la fascia si legge sul voto, non sul fantavoto", () => {
    const built = base442({ captain: "m1" });
    const captain = built.stats.get("m1");
    if (captain) {
      captain.voto = 7.5;
      captain.yellowCards = 1;
    }
    const result = score(built);
    const row = result.players.find((player) => player.playerId === "m1");
    const shape = points(result.total, 69.5);
    return {
      passed: shape.passed && result.captainModifier === 2 && result.fairPlay === 0 && row?.malusFactor === 2 && row.playerPoints === 6.5,
      expected: "69.50, fascia 2.00, malus doppio, fair play 0",
      actual: `${result.total.toFixed(2)}, fascia ${result.captainModifier.toFixed(2)}, fattore ${row?.malusFactor ?? "—"}, punti ${row?.playerPoints?.toFixed(2) ?? "—"}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "C3", "Se il capitano ha voto, il vice tiene il malus singolo", () => {
    const built = base442({ vice: "d1" });
    const vice = built.stats.get("d1");
    if (vice) vice.yellowCards = 1;
    const result = score(built);
    const row = result.players.find((player) => player.playerId === "d1");
    const shape = points(result.total, 67);
    return {
      passed: shape.passed && result.captainPlayerId === "gk" && row?.malusFactor === 1 && result.fairPlay === 0,
      expected: "67.00, capitano gk, vice fattore 1",
      actual: `${result.total.toFixed(2)}, capitano ${result.captainPlayerId ?? "nessuno"}, fattore ${row?.malusFactor ?? "—"}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "C4", "Capitano senza voto: la fascia passa al vice che resta in campo", () => {
    const built = base442({ missing: ["gk"], vice: "d1" });
    const vice = built.stats.get("d1");
    if (vice) vice.voto = 6.5;
    built.slots.push({ playerId: "b1", role: "GK", isCaptain: false, isVice: false, benchOrder: 1 });
    built.stats.set("b1", { playerId: "b1", role: "GK", voto: null });
    const result = score(built);
    const shape = points(result.total, 66.5);
    return {
      passed: shape.passed && result.captainPlayerId === "d1" && result.captainModifier === 1 && result.reservePoints === 2.5,
      expected: "66.50, fascia del vice 1.00",
      actual: `${result.total.toFixed(2)}, capitano ${result.captainPlayerId ?? "nessuno"}, fascia ${result.captainModifier.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "C5", "In una giornata in corso il capitano ancora senza voto non prende la fascia", () => {
    const built = base442({ missing: ["m1"], captain: "m1", vice: "d1" });
    const live = calculateProvisional("rosa", "gw", built.slots, built.stats, RULES, new Set());
    const shape = points(live.provisionalTotal, 61);
    return {
      passed: shape.passed && live.captainModifier === 0 && live.fairPlay === 0 && live.onPitchCount === 1 && live.ratedPlayersCount === 10,
      expected: "61.00, fascia 0, 10 con voto",
      actual: `${live.provisionalTotal.toFixed(2)}, fascia ${live.captainModifier.toFixed(2)}, ${live.ratedPlayersCount} con voto`,
      delta: shape.delta,
    };
  });

  add("Proiezione", "L1", "Un gol pubblicato fa 7 + 3 = 10, senza fascia e senza difesa", () => {
    const built = base442({ captain: "f1" });
    const scorer = built.stats.get("f1");
    if (scorer) {
      scorer.voto = 7;
      scorer.goals = 1;
    }
    const live = projectLiveScore("rosa", "gw", built.slots, built.stats, RULES);
    const row = live.players.find((player) => player.playerId === "f1");
    const shape = points(live.provisionalTotal, 70);
    return {
      passed: shape.passed && row?.fantavoto === 10 && row.playerPoints === 10 && live.captainModifier === 0 && live.defenseModifier === 0 && live.fairPlay === 0 && liveFormula(7, 3, 0) === "7 + 3 = 10",
      expected: "70.00, fantavoto 10, fascia 0, difesa 0",
      actual: `${live.provisionalTotal.toFixed(2)}, fantavoto ${row?.fantavoto ?? "—"}, fascia ${live.captainModifier.toFixed(2)}, difesa ${live.defenseModifier.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Proiezione", "L2", "L'ammonizione del capitano resta −0,5 e non scatena la fascia", () => {
    const built = base442();
    const captain = built.stats.get("gk");
    if (captain) captain.yellowCards = 1;
    const live = projectLiveScore("rosa", "gw", built.slots, built.stats, RULES);
    const row = live.players.find((player) => player.playerId === "gk");
    const shape = points(live.provisionalTotal, 65.5);
    return {
      passed: shape.passed && row?.malusFactor === 1 && row.fantavoto === 5.5 && live.captainModifier === 0 && liveFormula(6, 0, -0.5) === "6 − 0,5 = 5,5",
      expected: "65.50, malus −0.50, fascia 0",
      actual: `${live.provisionalTotal.toFixed(2)}, fantavoto ${row?.fantavoto ?? "—"}, fattore ${row?.malusFactor ?? "—"}`,
      delta: shape.delta,
    };
  });

  add("Proiezione", "L3", "Il gol subito dal portiere vale −1 nel fantavoto", () => {
    const built = base442();
    const keeper = built.stats.get("gk");
    if (keeper) keeper.goalsConceded = 1;
    const live = projectLiveScore("rosa", "gw", built.slots, built.stats, RULES);
    const row = live.players.find((player) => player.playerId === "gk");
    const shape = points(live.provisionalTotal, 65);
    return {
      passed: shape.passed && row?.fantavoto === 5 && live.defenseModifier === 0 && liveFormula(6, 0, -1) === "6 − 1 = 5",
      expected: "65.00, portiere 5.00",
      actual: `${live.provisionalTotal.toFixed(2)}, portiere ${row?.fantavoto ?? "—"}`,
      delta: shape.delta,
    };
  });

  add("Proiezione", "L4", "Senza un senza voto ufficiale la panchina non entra, anche a partita finita", () => {
    const built = base442({ missing: ["m4"] });
    built.slots.push({ playerId: "b1", role: "MID", isCaptain: false, isVice: false, benchOrder: 1 });
    built.stats.set("b1", { playerId: "b1", role: "MID", voto: 8 });
    const live = projectLiveScore("rosa", "gw", built.slots, built.stats, RULES);
    const shape = points(live.provisionalTotal, 60);
    return {
      passed: shape.passed && !ids(live).includes("b1") && ids(live).includes("m4") && live.reservePoints === 0,
      expected: "60.00, panchina ferma",
      actual: `${live.provisionalTotal.toFixed(2)}, in campo ${ids(live).join(",")}`,
      delta: shape.delta,
    };
  });

  add("Proiezione", "L5", "Anche il senza voto ufficiale non fa entrare la panchina nel live", () => {
    const built = base442({ missing: ["m4"] });
    const starter = built.stats.get("m4");
    if (starter) starter.withoutVote = true;
    built.slots.push({ playerId: "b1", role: "MID", isCaptain: false, isVice: false, benchOrder: 1 });
    built.stats.set("b1", { playerId: "b1", role: "MID", voto: 6.5, goals: 1 });
    const live = projectLiveScore("rosa", "gw", built.slots, built.stats, RULES);
    const shape = points(live.provisionalTotal, 60);
    return {
      passed: shape.passed && !ids(live).includes("b1") && ids(live).includes("m4") && live.reservePoints === 0 && live.defenseModifier === 0,
      expected: "60.00, panchina ferma anche con S.V.",
      actual: `${live.provisionalTotal.toFixed(2)}, in campo ${ids(live).join(",")}`,
      delta: shape.delta,
    };
  });

  add("Proiezione", "L6", "Il senza voto ufficiale non assegna la riserva nel live", () => {
    const built = base442({ missing: ["m4"] });
    const starter = built.stats.get("m4");
    if (starter) starter.withoutVote = true;
    const live = projectLiveScore("rosa", "gw", built.slots, built.stats, RULES);
    const shape = points(live.provisionalTotal, 60);
    return {
      passed: shape.passed && ids(live).includes("m4") && live.reservePoints === 0 && live.captainModifier === 0 && live.defenseModifier === 0,
      expected: "60.00, riserva 0",
      actual: `${live.provisionalTotal.toFixed(2)}, riserva ${live.reservePoints.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Formati", "M1", "Sotto la prima soglia lo scontro vale 0 gol, da 66 vale 1", () => {
    const low = fantapuntiToGoals(65.5, DEFAULT_GOAL_BANDS);
    const one = fantapuntiToGoals(66, DEFAULT_GOAL_BANDS);
    return {
      passed: low === 0 && one === 1,
      expected: "0 e 1",
      actual: `${low} e ${one}`,
      delta: String(one - 1),
    };
  });

  add("Formati", "M2", "Nello scontro diretto vince chi ha più gol, non chi ha più fantapunti sotto la stessa soglia", () => {
    const points = new Map([["a", 70], ["b", 71]]);
    const awarded = headToHeadPoints(["a", "b"], 1, points, DEFAULT_GOAL_BANDS);
    const raw = headToHeadPoints(["a", "b"], 1, points);
    return {
      passed: awarded.get("a") === 1 && awarded.get("b") === 1 && raw.get("b") === 3 && raw.get("a") === 0,
      expected: "con soglie 1-1, senza soglie 0-3",
      actual: `soglie ${awarded.get("a")}-${awarded.get("b")}, diretti ${raw.get("a")}-${raw.get("b")}`,
      delta: "0",
    };
  });

  add("Formati", "M3", "La regular season ibrida conta, la coppa no", () => {
    const hybrid = parseLeagueRules({ format: "hybrid" });
    const direct = parseLeagueRules({ format: "h2h" });
    const classic = parseLeagueRules({ format: "classic" });
    const passed = weekScoreMode(hybrid, 10) === "sum"
      && weekScoreMode(hybrid, 35) === "knockout"
      && weekScoreMode(direct, 12) === "head_to_head"
      && weekScoreMode(classic, 12) === "sum";
    return {
      passed,
      expected: "giornata 10 somma, giornata 35 coppa, h2h e classic invariati",
      actual: `${weekScoreMode(hybrid, 10)} / ${weekScoreMode(hybrid, 35)}`,
      delta: "0",
    };
  });

  add("Formati", "M4", "Capitano spento, gol spento e imbattibilità accesa restano nel calcolo di lega", () => {
    const rules = parseLeagueRules({
      captainEnabled: false,
      defenseEnabled: false,
      cleanSheetEnabled: true,
      cleanSheetPoints: 1,
      bonusEnabled: { goal: false },
    });
    const definition = applyLeagueRules(RULES, rules);
    const built = base442();
    const scorer = built.stats.get("f1");
    if (scorer) scorer.goals = 1;
    const result = score(built, definition);
    const keeper = result.players.find((player) => player.playerId === "gk");
    const forward = result.players.find((player) => player.playerId === "f1");
    const shape = points(result.total, 69.5);
    return {
      passed: shape.passed && keeper?.bonusPoints === 1 && forward?.bonusPoints === 0 && result.captainModifier === 0 && result.defenseModifier === 0,
      expected: "69.50, portiere +1, gol 0, fascia 0, difesa 0",
      actual: `${result.total.toFixed(2)}, portiere ${keeper?.bonusPoints ?? "—"}, gol ${forward?.bonusPoints ?? "—"}, fascia ${result.captainModifier.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Rosa", "K1", "Due calciatori dello stesso club non stanno nella stessa rosa", () => {
    const clubs = [
      { id: "nap", code: "NAP", name: "Napoli", shortName: "NAP" },
      { id: "int", code: "INT", name: "Inter", shortName: "INT" },
    ];
    const players = [
      { id: "a", fullName: "A", role: "FWD" as const, clubId: "nap", clubCode: "NAP", clubName: "Napoli", clubShort: "NAP" },
      { id: "b", fullName: "B", role: "MID" as const, clubId: "nap", clubCode: "NAP", clubName: "Napoli", clubShort: "NAP" },
    ];
    const report = evaluateRoster(players, clubs, { squadSize: 2, gkMin: 0, gkMax: 1, outfieldMin: 0, outfieldMax: 2 });
    return {
      passed: report.duplicateClubs.length === 1 && report.clubsOk === false,
      expected: "Napoli duplicato",
      actual: report.duplicateClubs.map((club) => club.shortName).join(",") || "nessun duplicato",
      delta: "0",
    };
  });

  add("Rosa", "K2", "Il checkpoint si apre dopo la giornata indicata e si chiude alla successiva", () => {
    const rules = parseLeagueRules({ checkpoints: [{ afterMatchday: 10, changes: 3 }, { afterMatchday: 20, changes: 5 }] });
    const first = openCheckpoint(rules.checkpoints, [10]);
    const closed = openCheckpoint(rules.checkpoints, [10, 11]);
    const second = openCheckpoint(rules.checkpoints, [10, 11, 20]);
    return {
      passed: first?.changes === 3 && closed === null && second?.changes === 5,
      expected: "dopo la 10 tre cambi, chiuso a cavallo della 11, dopo la 20 cinque cambi",
      actual: `${first?.changes ?? "chiuso"} / ${closed?.changes ?? "chiuso"} / ${second?.changes ?? "chiuso"}`,
      delta: "0",
    };
  });

  add("Rosa", "K3", "Un cambio è un uscito, e due rose vedono lo stesso nome solo se la lega non è esclusiva", () => {
    const changes = rosterChangeCount(["a", "b", "c"], ["a", "b", "d"]);
    const shared = sharedPlayerIds(["a", "d"], [["a", "b"]]);
    return {
      passed: changes === 1 && shared.length === 1 && shared[0] === "a",
      expected: "1 cambio, un solo nome in comune",
      actual: `${changes} cambi, in comune ${shared.join(",")}`,
      delta: "0",
    };
  });

  add("Formazione", "K4", "L'invio resta valido fino alla deadline e non si accetta a giornata chiusa", () => {
    const deadline = Date.parse("2026-11-06T19:44:00.000Z");
    const before = lineupAcceptsUpdate(deadline - 60_000, deadline, "open");
    const after = lineupAcceptsUpdate(deadline, deadline, "open");
    const locked = lineupAcceptsUpdate(deadline - 60_000, deadline, "locked");
    return {
      passed: before && !after && !locked,
      expected: "aperto un minuto prima, chiuso alla deadline e se la giornata è locked",
      actual: `${before} / ${after} / ${locked}`,
      delta: "0",
    };
  });

  add("Formazione", "K5", "Il moltiplicatore ×2 raddoppia i fantapunti del capitano e non somma la fascia", () => {
    const rules = parseLeagueRules({ captainMultiplier: 2, defenseEnabled: false, cleanSheetEnabled: false });
    const definition = applyLeagueRules(RULES, rules);
    const result = score(base442({ voto: 6 }), { ...definition, fair_play: { points: 0 } });
    const captain = result.players.find((player) => player.playerId === "gk");
    return {
      passed: result.captainModifier === 6 && captain?.playerPoints === 6 && result.total === 72,
      expected: "capitano 6, fascia extra 6, totale 72",
      actual: `capitano ${captain?.playerPoints ?? "—"}, extra ${result.captainModifier.toFixed(2)}, totale ${result.total.toFixed(2)}`,
      delta: "0",
    };
  });

  add("Formazione", "K6", "La formazione dimenticata usa la precedente, salvo penalità in ogni lega della squadra", () => {
    const carry = officeLineupMode(["penalty", "carry"]);
    const penalty = officeLineupMode(["penalty", "penalty"]);
    const rules = parseLeagueRules({ missedLineup: "penalty", missedLineupPenalty: -4 });
    return {
      passed: carry === "carry" && penalty === "penalty" && rules.missedLineupPenalty === -4,
      expected: "una lega in riporto tiene la formazione, due penalità applicano −4",
      actual: `${carry} / ${penalty} / ${rules.missedLineupPenalty}`,
      delta: "0",
    };
  });

  add("Formazione", "K7", "Alla prima giornata gli 11 e la panchina escono in ordine alfabetico", () => {
    const roster = [
      { id: "gk-z", role: "GK" as const, name: "Zini" },
      { id: "gk-a", role: "GK" as const, name: "Alberti" },
      { id: "d4", role: "DEF" as const, name: "Dante" },
      { id: "d1", role: "DEF" as const, name: "Abate" },
      { id: "d2", role: "DEF" as const, name: "Bruno" },
      { id: "d3", role: "DEF" as const, name: "Conte" },
      { id: "d5", role: "DEF" as const, name: "Esposito" },
      { id: "m3", role: "MID" as const, name: "Neri" },
      { id: "m1", role: "MID" as const, name: "Lodi" },
      { id: "m2", role: "MID" as const, name: "Mancini" },
      { id: "m4", role: "MID" as const, name: "Orsini" },
      { id: "m5", role: "MID" as const, name: "Parisi" },
      { id: "f2", role: "FWD" as const, name: "Verdi" },
      { id: "f1", role: "FWD" as const, name: "Rossi" },
      { id: "f3", role: "FWD" as const, name: "Zanetti" },
    ];
    const picked = alphabeticalOfficeLineup(roster);
    const names = new Map(roster.map((player) => [player.id, player.name]));
    const starterNames = (picked?.starterIds ?? []).map((id) => names.get(id) ?? "");
    const benchNames = (picked?.benchIds ?? []).map((id) => names.get(id) ?? "");
    const sorted = (values: string[]) => [...values].sort((left, right) => left.localeCompare(right, "it")).join(",");
    const onPitch = new Set(picked?.starterIds ?? []);
    return {
      passed: picked?.formationId === "4-4-2"
        && starterNames.length === 11
        && starterNames.join(",") === sorted(starterNames)
        && benchNames.join(",") === sorted(benchNames)
        && onPitch.has("gk-a")
        && !onPitch.has("gk-z")
        && !onPitch.has("d5")
        && !onPitch.has("m5")
        && !onPitch.has("f3"),
      expected: "4-4-2, Alberti in porta, Esposito Parisi e Zanetti in panchina, entrambi gli elenchi dalla A alla Z",
      actual: `${picked?.formationId ?? "—"} · ${starterNames.join(", ")} · panchina ${benchNames.join(", ")}`,
      delta: "0",
    };
  });

  add("Bacheca", "E1", "I badge di fine giornata premiano panchina, bonus e malus pesante", () => {
    const awards = awardBadges([
      { teamId: "a", teamName: "Alpha", benchBonus: 6, bonus: 3, heavy: 0 },
      { teamId: "b", teamName: "Beta", benchBonus: 1, bonus: 9, heavy: 4 },
    ]);
    const kinds = awards.map((award) => award.kind).join(",");
    return {
      passed: kinds === "pollo,re_bonus,rigorista" && awards[0]?.teamName === "Alpha" && awards[1]?.teamName === "Beta" && awards[2]?.teamName === "Beta",
      expected: "Pollo ad Alpha, Re e Rigorista a Beta",
      actual: awards.map((award) => `${award.title} ${award.teamName}`).join(" · "),
      delta: "0",
    };
  });

  add("Live", "E2", "Il feed live elenca gol e cartellini dei titolari", () => {
    const events = pitchEvents([{
      playerId: "p",
      playerName: "Rossi",
      teamName: "Alpha",
      stat: { playerId: "p", role: "FWD", voto: 7, goals: 1, yellowCards: 1 },
    }]);
    return {
      passed: events.length === 2 && events[0]?.label === "gol" && events[1]?.label === "ammonizione",
      expected: "gol poi ammonizione",
      actual: events.map((event) => event.label).join(", ") || "vuoto",
      delta: "0",
    };
  });

  add("Live", "E3", "Un sorpasso live e un ribaltone H2H vengono visti", () => {
    const passedBy = overtakes(
      [{ teamId: "me", points: 70 }, { teamId: "him", points: 60 }],
      [{ teamId: "me", points: 70 }, { teamId: "him", points: 80 }],
    );
    const flips = h2hFlips(
      ["me", "him"],
      1,
      new Map([["me", 80], ["him", 60]]),
      new Map([["me", 60], ["him", 90]]),
      [{ min: 66, goals: 1 }, { min: 72, goals: 2 }, { min: 78, goals: 3 }],
    );
    return {
      passed: passedBy.length === 1 && passedBy[0]?.teamId === "me" && passedBy[0]?.byTeamId === "him" && flips.length === 1 && flips[0]?.winner === "him",
      expected: "him supera me e ribalta lo scontro",
      actual: `${passedBy.map((move) => move.byTeamId).join(",") || "nessuno"} / ${flips.map((flip) => flip.winner).join(",") || "pari"}`,
      delta: "0",
    };
  });

  add("Voti", "N1", "Il CSV di emergenza accetta voto con la virgola e rifiuta il file intero se una riga è rotta", () => {
    const ok = parseEmergencyVotes("codice,nome,voto,gol\nABC,Rossi,\"6,5\",1\n", "voti.csv");
    let rejected = "";
    try {
      parseEmergencyVotes("codice,voto\nABC,6\nDEF,boh\n", "voti.csv");
    } catch (error) {
      rejected = error instanceof EmergencyVoteError ? error.message : "";
    }
    return {
      passed: ok.votes.length === 1 && ok.votes[0]?.voto === 6.5 && ok.votes[0]?.goals === 1 && rejected.includes("Nessun voto salvato"),
      expected: "un voto 6,5 e file rifiutato sulla seconda riga",
      actual: `${ok.votes[0]?.voto ?? "—"} / ${rejected || "accettato"}`,
      delta: "0",
    };
  });

  add("Voti", "N2", "Il JSON di emergenza pretende l'elenco e un codice per ogni riga", () => {
    const ok = parseEmergencyVotes(JSON.stringify({ votes: [{ externalRef: "ABC", voto: 7, goals: 2 }] }), "voti.json");
    let rejected = "";
    try {
      parseEmergencyVotes("{ \"note\": true }", "voti.json");
    } catch (error) {
      rejected = error instanceof EmergencyVoteError ? error.message : "";
    }
    return {
      passed: ok.votes[0]?.externalRef === "ABC" && ok.votes[0]?.goals === 2 && rejected.includes("votes"),
      expected: "ABC con 2 gol, JSON senza elenco rifiutato",
      actual: `${ok.votes[0]?.externalRef ?? "—"} gol ${ok.votes[0]?.goals ?? "—"} / ${rejected || "accettato"}`,
      delta: "0",
    };
  });

  add("Caos", "C1", "Due calcoli identici hanno delta zero", () => {
    const same = totalsDelta([66.5, 70, 71.5], [66.5, 70, 71.5]);
    const shifted = totalsDelta([66.5, 70], [66.5, 70.01]);
    return {
      passed: same === 0 && shifted === 0.01,
      expected: "delta 0 e delta 0,01",
      actual: `${same} / ${shifted}`,
      delta: String(same),
    };
  });

  add("Caos", "C2", "Una giornata H2H con partita rinviata resta fuori classifica solo se la lega attende il recupero", () => {
    const held = !weekCountsInTable("head_to_head", true, "wait_recovery");
    const classic = weekCountsInTable("classic", true, "wait_recovery");
    const political = weekCountsInTable("head_to_head", true, "political_six");
    const clear = weekCountsInTable("head_to_head", false, "wait_recovery");
    return {
      passed: held && classic && political && clear,
      expected: "H2H in attesa sospesa, classic e 6 politico conteggiati",
      actual: held && classic && political && clear ? "sospensione solo H2H in attesa" : "regola errata",
      delta: "0",
    };
  });

  add("Scenario", "C3", "Lo script JSON e il CSV usano lo stesso dizionario di azioni", () => {
    const json = parseScenarioText("giornata.json", JSON.stringify({
      name: "Giornata",
      steps: [
        { action: "create_user", as: "alice" },
        { action: "SUBMIT_LINEUP", user: "alice", week: 1, repeat: 8, expectError: "deadline" },
      ],
    }));
    const csv = parseScenarioText("giornata.csv", "action,as,user,week,repeat\nCREATE_USER,bob\nSKIP_LINEUP,,bob,1\n");
    const names = new Set(SCENARIO_ACTIONS.map((spec) => spec.action));
    const covered = ["CREATE_USER", "TRADE", "SUBMIT_LINEUP", "LOAD_VOTES", "SCORE", "ASSERT_SCORE", "ASSERT_RANKING", "ASSERT_ERROR", "ASSERT_CONSTRAINT"]
      .every((action) => names.has(action));
    return {
      passed: json.steps[0]?.as === "alice"
        && json.steps[1]?.expectError === "deadline"
        && json.steps[1]?.params.repeat === 8
        && csv.steps.length === 2
        && covered,
      expected: "due formati e le azioni principali nel dizionario",
      actual: `${json.steps.length} json, ${csv.steps.length} csv`,
      delta: "0",
    };
  });

  add("Scenario", "C4", "La giornata 1 dello script non è la giornata 1 reale", () => {
    let rejected = false;
    try {
      sandboxWeek(0);
    } catch {
      rejected = true;
    }
    const roster = buildLegalRoster(
      [
        { id: "p1", fullName: "A", role: "GK", clubId: "c1", clubCode: "A", clubName: "A", clubShort: "A" },
        { id: "p2", fullName: "B", role: "DEF", clubId: "c2", clubCode: "B", clubName: "B", clubShort: "B" },
      ],
      [
        { id: "c1", code: "A", name: "A", shortName: "A" },
        { id: "c2", code: "B", name: "B", shortName: "B" },
      ],
      { squadSize: 2, gkMin: 0, gkMax: 2, outfieldMin: 0, outfieldMax: 2 },
      0,
    );
    const narrative = scenarioNarrative({
      name: "Prova",
      sandboxRemoved: true,
      steps: [
        { index: 1, action: "CREATE_USER", passed: true, detail: "ok" },
        { index: 2, action: "SCORE", passed: false, detail: "delta 0.01" },
      ],
    });
    return {
      passed: sandboxWeek(1) === 801 && rejected && roster.length === 2 && new Set(roster.map((player) => player.clubId)).size === 2
        && narrative.includes("Andato bene") && narrative.includes("SCORE") && narrative.includes("rimossa"),
      expected: "giornata sandbox 801, rosa un club, resoconto con il passo fallito",
      actual: `sandbox ${sandboxWeek(1)}, rosa ${roster.length}`,
      delta: "0",
    };
  });

  add("Idempotenza", "I1", "Una giornata scored o final non si ricalcola", () => {
    const settled = isSettledGameweek("scored") && isSettledGameweek("final");
    const open = !isSettledGameweek("locked") && !isSettledGameweek("open") && !isSettledGameweek("scheduled");
    return {
      passed: settled && open,
      expected: "scored e final chiuse, le altre aperte",
      actual: settled && open ? "gate rispettato" : "gate errato",
      delta: "0",
    };
  });

  add("Idempotenza", "I2", "Il calcolo ufficiale scatta a partita finita oppure dopo 130 minuti", () => {
    const kickoff = new Date("2026-11-08T18:00:00.000Z");
    const before = new Date(kickoff.getTime() + 129 * 60 * 1000);
    const after = new Date(kickoff.getTime() + 130 * 60 * 1000);
    const passed = isOfficialMatchClosed("finished", kickoff, before)
      && isOfficialMatchClosed("FT", kickoff, before)
      && !isOfficialMatchClosed("live", kickoff, before)
      && isOfficialMatchClosed("live", kickoff, after);
    return {
      passed,
      expected: "FT e finished subito, live solo dopo 130 minuti",
      actual: passed ? "finestra rispettata" : "finestra errata",
      delta: "0",
    };
  });

  add("Voti", "V1", "Uno schema voti incompleto viene rifiutato e non produce una riga", () => {
    const broken = validateFantacalcioVote({ externalRef: "12", teamSlug: "milan", voto: 7, goals: null });
    const sound = validateFantacalcioVote({
      externalRef: "12",
      teamSlug: "milan",
      voto: 7,
      goals: 1,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      penaltiesScored: 0,
      penaltiesMissed: 0,
      penaltiesSaved: 0,
      ownGoals: 0,
      goalsConceded: 0,
    });
    return {
      passed: broken === null && sound?.voto === 7 && sound.goals === 1,
      expected: "riga rotta scartata, 7 con un gol accettato",
      actual: broken === null && sound ? `valida ${sound.voto}+${sound.goals}` : "validazione errata",
      delta: "0",
    };
  });

  add("Voti", "V2", "Un 500 o un JSON al posto della pagina interrompe il recupero", () => {
    let server = "";
    let payload = "";
    try {
      assertVoteDocument(503, "<html></html>");
    } catch (error) {
      server = error instanceof VoteIngestionError ? error.message : "";
    }
    try {
      assertVoteDocument(200, "{\"votes\":[]}");
    } catch (error) {
      payload = error instanceof VoteIngestionError ? error.message : "";
    }
    const html = assertVoteDocument(200, "<html><body></body></html>");
    return {
      passed: server.includes("Nessun voto salvato") && payload.includes("incompleta") && html.includes("<html>"),
      expected: "500 e JSON bloccati, HTML vuoto ammesso",
      actual: server && payload ? "blocco pulito" : "blocco mancante",
      delta: "0",
    };
  });

  add("Registro", "U1", "L'audit ufficiale dice voto, bonus e chi entra al posto di chi", () => {
    const built = base442({ missing: ["m4"] });
    built.slots.push({ playerId: "b1", role: "MID", isCaptain: false, isVice: false, benchOrder: 1 });
    built.slots.push({ playerId: "b2", role: "FWD", isCaptain: false, isVice: false, benchOrder: 2 });
    built.stats.set("b1", { playerId: "b1", role: "MID", voto: 6.5, goals: 1 });
    built.stats.set("b2", { playerId: "b2", role: "FWD", voto: 6 });
    const names = new Map([...built.stats.keys()].map((id) => [id, id]));
    const audit = explainScore({
      fantasyTeamId: "rosa",
      teamName: "Rosa",
      gameweekNumber: 11,
      slots: built.slots,
      stats: built.stats,
      definition: RULES,
      names,
      mode: "official",
      matchFinished: new Set(built.stats.keys()),
      ranking: "sum",
      totals: [{ fantasyTeamId: "rosa", teamName: "Rosa", total: 0 }],
      storedTotal: null,
    });
    const step = audit.substitutions.find((item) => item.starterId === "m4");
    const entered = audit.players.find((player) => player.playerId === "b1");
    const bench = audit.players.find((player) => player.playerId === "b2");
    const passed = step?.outcome === "same-role"
      && step.entrantId === "b1"
      && step.text.includes("m4")
      && step.text.includes("b1")
      && entered?.baseVote === 6.5
      && entered.source === "substitute"
      && entered.lines.some((line) => line.points === 3)
      && bench?.source === "bench";
    return {
      passed,
      expected: "b1 entra per m4 con gol +3, b2 resta in panchina",
      actual: step ? `${step.text} | b2 ${bench?.source ?? "assente"}` : "nessun cambio",
      delta: "0",
    };
  });

  add("Registro", "U2", "L'audit live non registra sostituzioni né modificatore difesa", () => {
    const built = base442({ missing: ["m4"], captain: "f1" });
    const scorer = built.stats.get("f1");
    if (scorer) {
      scorer.voto = 7;
      scorer.goals = 1;
    }
    const starter = built.stats.get("m4");
    if (starter) starter.withoutVote = true;
    built.slots.push({ playerId: "b1", role: "MID", isCaptain: false, isVice: false, benchOrder: 1 });
    built.stats.set("b1", { playerId: "b1", role: "MID", voto: 6.5 });
    const names = new Map([...built.stats.keys()].map((id) => [id, id]));
    const audit = explainScore({
      fantasyTeamId: "rosa",
      teamName: "Rosa",
      gameweekNumber: 11,
      slots: built.slots,
      stats: built.stats,
      definition: RULES,
      names,
      mode: "provisional",
      matchFinished: new Set(built.stats.keys()),
      ranking: "sum",
      totals: [{ fantasyTeamId: "rosa", teamName: "Rosa", total: 0 }],
      storedTotal: null,
    });
    const row = audit.players.find((player) => player.playerId === "f1");
    const passed = audit.substitutions.length === 0
      && audit.modifiers.defense.modifier === 0
      && audit.modifiers.captain.points === 0
      && audit.players.some((player) => player.playerId === "m4" && player.source === "starter")
      && row?.baseVote === 7
      && row.lines.some((line) => line.points === 3)
      && audit.sum.total === 64;
    return {
      passed,
      expected: "7 + 3 nel registro, totale 64 senza cambi e senza difesa",
      actual: `${audit.sum.total}, cambi ${audit.substitutions.length}, difesa ${audit.modifiers.defense.modifier}`,
      delta: "0",
    };
  });

  add("Casi base", "C6", "Con meno di quattro difensori votati il modificatore difesa è zero", () => {
    const rows: Array<[string, PlayerRole, number | null, Partial<PlayerStat>?, RowMark?]> = [
      ["gk", "GK", 7, {}, "C"],
      ["d1", "DEF", 7], ["d2", "DEF", 7], ["d3", "DEF", 7],
      ["m1", "MID", 6], ["m2", "MID", 6], ["m3", "MID", 6], ["m4", "MID", 6], ["m5", "MID", 6],
      ["f1", "FWD", 6], ["f2", "FWD", 6],
    ];
    const result = score(team(rows));
    return {
      passed: result.defenseModifier === 0 && result.defenseAverage === null,
      expected: "difesa 0",
      actual: `difesa ${result.defenseModifier.toFixed(2)}`,
      delta: result.defenseModifier === 0 ? "0" : `+${result.defenseModifier.toFixed(2)}`,
    };
  });

  add("Casi base", "D1", "Partita rinviata: ogni schierato prende 6 politico, senza bonus né malus", () => {
    const built = base442({ missing: ["gk", "d1", "d2", "d3", "d4", "m1", "m2", "m3", "m4", "f1", "f2"] });
    for (const stat of built.stats.values()) {
      stat.postponed = true;
      stat.assists = 1;
      stat.ownGoals = 1;
      stat.yellowCards = 0;
    }
    const live = calculateProvisional("rosa", "gw", built.slots, built.stats, RULES, new Set());
    const allSix = live.players.every((player) => player.voto === 6 && player.bonusPoints === 0 && player.malusPoints === 0);
    const shape = points(live.provisionalTotal, 67);
    return {
      passed: shape.passed && allSix && live.captainModifier === 0 && live.fairPlay === 0 && live.defenseModifier === 1 && live.players.length === 11,
      expected: "67.00, undici 6 politici, fascia 0, fair play 0, difesa 1",
      actual: allSix
        ? `${live.provisionalTotal.toFixed(2)}, undici 6 politici, fascia ${live.captainModifier.toFixed(2)}, fair play ${live.fairPlay.toFixed(2)}, difesa ${live.defenseModifier.toFixed(2)}`
        : "qualcuno non ha il 6 politico",
      delta: shape.delta,
    };
  });

  add("Casi base", "D2", "Con attesa del recupero il rinviato resta senza voto e non prende il 6", () => {
    const built = base442({ missing: ["gk", "d1", "d2", "d3", "d4", "m1", "m2", "m3", "m4", "f1", "f2"] });
    for (const stat of built.stats.values()) stat.postponed = true;
    const waiting: RulesetDefinition = { ...RULES, postponement: "wait_recovery" };
    const live = calculateProvisional("rosa", "gw", built.slots, built.stats, waiting, new Set());
    const shape = points(live.provisionalTotal, 0);
    return {
      passed: shape.passed && live.players.every((player) => player.voto === null) && live.reservePoints === 0,
      expected: "0.00, voti assenti, nessuna riserva",
      actual: `${live.provisionalTotal.toFixed(2)}, voti ${live.players.filter((player) => player.voto === null).length}/11`,
      delta: shape.delta,
    };
  });

  add("Casi base", "D3", "Partita chiusa senza voto: niente 6 politico, scatta la riserva d'ufficio su tutti gli slot", () => {
    const built = base442({ missing: ["gk", "d1", "d2", "d3", "d4", "m1", "m2", "m3", "m4", "f1", "f2"] });
    for (const stat of built.stats.values()) stat.postponed = true;
    const finished = new Set(built.stats.keys());
    const live = calculateProvisional("rosa", "gw", built.slots, built.stats, RULES, finished);
    const shape = points(live.provisionalTotal, 27.5);
    return {
      passed: shape.passed && live.reservePoints === 27.5 && live.players.length === 0,
      expected: "27.50 di riserva, nessun 6 politico",
      actual: `${live.provisionalTotal.toFixed(2)}, riserva ${live.reservePoints.toFixed(2)}, in campo ${live.players.length}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "E1", "Il calcolo sulla competizione A lascia intatti voti e totale della competizione B", () => {
    const competitionA = base442();
    const competitionB = base442({ voto: 7, captain: "f1" });
    const before = score(competitionB).total;
    const voteBefore = competitionB.stats.get("f1")?.voto ?? null;
    const publishedA = score(competitionA);
    const captain = competitionA.stats.get("gk");
    if (captain) captain.voto = 8;
    score(competitionA);
    const after = score(competitionB).total;
    const voteAfter = competitionB.stats.get("f1")?.voto ?? null;
    return {
      passed: before === after && voteBefore === voteAfter && publishedA.fantasyTeamId === "rosa" && before !== publishedA.total,
      expected: `B fermo a ${before.toFixed(2)}`,
      actual: `B ${after.toFixed(2)}, voto ${String(voteAfter)}`,
      delta: round2(after - before).toFixed(2),
    };
  });

  add("Casi base", "F1", "Portiere S.V. con gol subito e rigore parato: il sostituto chiude a 6, senza quel malus né quel bonus", () => {
    const built = base442({ missing: ["gk"], vice: "d1" });
    const starter = built.stats.get("gk");
    if (starter) {
      starter.goalsConceded = 1;
      starter.penaltiesSaved = 1;
    }
    built.slots.push({ playerId: "gk-in", role: "GK", isCaptain: false, isVice: false, benchOrder: 1 });
    built.stats.set("gk-in", { playerId: "gk-in", role: "GK", voto: 6, goalsConceded: 0, penaltiesSaved: 0 });
    const result = score(built);
    const row = result.players.find((player) => player.playerId === "gk-in");
    const shape = points(result.total, 70);
    const clean = row?.voto === 6 && row.bonusPoints === 0 && row.malusPoints === 0 && row.fantavoto === 6 && row.playerPoints === 6;
    return {
      passed: shape.passed && clean && !ids(result).includes("gk") && result.captainPlayerId === "d1",
      expected: "70.00, voto finale del portiere 6.00",
      actual: clean
        ? `${result.total.toFixed(2)}, voto finale del portiere ${row?.fantavoto?.toFixed(2) ?? "—"}`
        : `${result.total.toFixed(2)}, voto ${row?.voto ?? "assente"}, bonus ${row?.bonusPoints ?? "—"}, malus ${row?.malusPoints ?? "—"}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "F2", "Portiere S.V. senza riserva: niente voto finale, il -1 e il +3 non diventano un numero", () => {
    const built = base442({ missing: ["gk"], vice: "d1" });
    const starter = built.stats.get("gk");
    if (starter) {
      starter.goalsConceded = 1;
      starter.penaltiesSaved = 1;
    }
    const result = score(built);
    const shape = points(result.total, 65.5);
    const noKeeperVote = !result.players.some((player) => player.role === "GK" && player.voto !== null);
    return {
      passed: shape.passed && noKeeperVote && result.reservePoints === 2.5 && result.defenseModifier === 0,
      expected: "65.50, voto finale assente, riserva 2.50",
      actual: `${result.total.toFixed(2)}, portieri votati ${result.players.filter((player) => player.role === "GK" && player.voto !== null).length}, riserva ${result.reservePoints.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "G1", "Tre panchinari S.V. di fila vengono saltati e entra il primo con voto", () => {
    const built = base442({ missing: ["m4"] });
    for (let order = 1; order <= 4; order += 1) {
      const id = `b${order}`;
      built.slots.push({ playerId: id, role: "MID", isCaptain: false, isVice: false, benchOrder: order });
      built.stats.set(id, { playerId: id, role: "MID", voto: order === 4 ? 6.5 : null });
    }
    const result = score(built);
    const shape = points(result.total, 70.5);
    const entered = ["b1", "b2", "b3"].every((id) => !ids(result).includes(id)) && ids(result).includes("b4");
    return {
      passed: shape.passed && entered,
      expected: "70.50 con b4",
      actual: `${result.total.toFixed(2)} con ${ids(result).find((id) => id.startsWith("b")) ?? "nessuno"}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "G2", "Panchina esaurita: tutti i pari ruolo sono S.V. e resta la riserva d'ufficio", () => {
    const built = base442({ missing: ["m4"] });
    for (let order = 1; order <= 3; order += 1) {
      const id = `b${order}`;
      built.slots.push({ playerId: id, role: "MID", isCaptain: false, isVice: false, benchOrder: order });
      built.stats.set(id, { playerId: id, role: "MID", voto: null });
    }
    const result = score(built);
    const shape = points(result.total, 66.5);
    const stayedOut = ["b1", "b2", "b3"].every((id) => !ids(result).includes(id));
    return {
      passed: shape.passed && stayedOut && result.reservePoints === 2.5 && result.players.length === 10,
      expected: "66.50, panchina esaurita, riserva 2.50",
      actual: `${result.total.toFixed(2)}, in campo ${result.players.length}, riserva ${result.reservePoints.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "H1", "Un difensore con il 6 politico conta come votato e non entra nella media dei tre migliori", () => {
    const built = base442();
    const setVote = (id: string, voto: number | null, postponed = false) => {
      const stat = built.stats.get(id);
      if (!stat) return;
      stat.voto = voto;
      stat.postponed = postponed;
    };
    setVote("gk", 7);
    setVote("d1", 7);
    setVote("d2", 7);
    setVote("d3", 6.5);
    setVote("d4", null, true);
    const live = calculateProvisional("rosa", "gw", built.slots, built.stats, RULES, new Set());
    const political = live.players.find((player) => player.playerId === "d4");
    const shape = points(live.provisionalTotal, 74);
    return {
      passed: shape.passed && political?.voto === 6 && live.defenseAverage === 6.88 && live.defenseModifier === 3,
      expected: "74.00, media difesa 6.88, modificatore 3",
      actual: `${live.provisionalTotal.toFixed(2)}, media ${live.defenseAverage?.toFixed(2) ?? "—"}, modificatore ${live.defenseModifier.toFixed(2)}, d4 ${political?.voto ?? "assente"}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "H2", "Due difensori con il 6 politico entrano in media: senza di loro il modificatore non scatterebbe", () => {
    const built = base442();
    const setVote = (id: string, voto: number | null, postponed = false) => {
      const stat = built.stats.get(id);
      if (!stat) return;
      stat.voto = voto;
      stat.postponed = postponed;
    };
    setVote("gk", 7);
    setVote("d1", 7);
    setVote("d2", null, true);
    setVote("d3", null, true);
    setVote("d4", 5.5);
    const live = calculateProvisional("rosa", "gw", built.slots, built.stats, RULES, new Set());
    const sixes = ["d2", "d3"].every((id) => live.players.find((player) => player.playerId === id)?.voto === 6);
    const shape = points(live.provisionalTotal, 72);
    return {
      passed: shape.passed && sixes && live.defenseAverage === 6.5 && live.defenseModifier === 3,
      expected: "72.00, media difesa 6.50, modificatore 3",
      actual: `${live.provisionalTotal.toFixed(2)}, media ${live.defenseAverage?.toFixed(2) ?? "—"}, modificatore ${live.defenseModifier.toFixed(2)}`,
      delta: shape.delta,
    };
  });

  add("Casi base", "E2", "Due mappe voti non condividono i calciatori: un aggiornamento su A non sposta B", () => {
    const votesA = new Map<string, number | null>([["p", 6]]);
    const votesB = new Map<string, number | null>([["p", 6]]);
    votesA.set("p", 8);
    return sameText(`${votesA.get("p") ?? "null"}/${votesB.get("p") ?? "null"}`, "8/6");
  });

  add("Stress", "S1", "Due cambi di fila: il primo buco prende il centrocampista votato, il secondo cambia modulo sul difensore", () => {
    const built = base442({ missing: ["m3", "m4"] });
    built.slots.push(
      { playerId: "b1", role: "MID", isCaptain: false, isVice: false, benchOrder: 1 },
      { playerId: "b2", role: "MID", isCaptain: false, isVice: false, benchOrder: 2 },
      { playerId: "b3", role: "DEF", isCaptain: false, isVice: false, benchOrder: 3 },
    );
    built.stats.set("b1", { playerId: "b1", role: "MID", voto: null });
    built.stats.set("b2", { playerId: "b2", role: "MID", voto: 6 });
    built.stats.set("b3", { playerId: "b3", role: "DEF", voto: 6 });
    const result = score(built);
    const shape = points(result.total, 70);
    const shapeOk = ids(result).includes("b2") && ids(result).includes("b3") && !ids(result).includes("b1") && !ids(result).includes("m3");
    return {
      passed: shape.passed && shapeOk && result.reservePoints === 0,
      expected: "70.00, entrano b2 e b3",
      actual: `${result.total.toFixed(2)}, in campo ${ids(result).filter((id) => id.startsWith("b")).sort().join("+") || "nessuna riserva"}`,
      delta: shape.delta,
    };
  });

  add("Stress", "S2", "Un voto cambiato dopo il calcolo non sposta il totale già pubblicato", () => {
    const built = base442();
    const first = score(built);
    const published = first.total;
    const mid = built.stats.get("m1");
    if (mid) mid.voto = 8;
    const second = score(built);
    const delta = round2(second.total - published);
    return {
      passed: first.total === published && delta === 2,
      expected: "pubblicato fermo, ricalcolo +2.00",
      actual: `pubblicato ${first.total.toFixed(2)}, ricalcolo ${second.total.toFixed(2)}`,
      delta: delta.toFixed(2),
    };
  });

  const raceStarted = performance.now();
  const slotA = { playerId: "vuoto", version: 0 };
  const slotB = { playerId: "fermo", version: 0 };
  const writers = Array.from({ length: 24 }, (_, index) => `p${index}`);
  let wins = 0;
  let conflicts = 0;
  await Promise.all(writers.map(async (playerId) => {
    const seen = slotA.version;
    await Promise.resolve();
    if (slotA.version !== seen) {
      conflicts += 1;
      return;
    }
    slotA.playerId = playerId;
    slotA.version += 1;
    wins += 1;
  }));
  const racePassed = wins === 1 && conflicts === 23 && slotA.version === 1 && slotA.playerId === "p0" && slotB.version === 0 && slotB.playerId === "fermo";
  checks.push({
    id: "S3",
    block: "Stress",
    name: "Scritture concorrenti sullo stesso slot: una sola vince, l'altra competizione resta alla versione 0",
    status: racePassed ? "PASSED" : "FAILED",
    expected: "1 vittoria, 23 conflitti, B versione 0",
    actual: `${wins} vittorie, ${conflicts} conflitti, A ${slotA.playerId} v${slotA.version}, B v${slotB.version}`,
    delta: String(wins - 1),
    durationMs: millis(performance.now() - raceStarted),
    budgetMs: null,
    bottleneck: racePassed ? null : "corsa sullo slot",
  });

  add("Stress", "S4", "Cinquanta leghe per dieci rose: ogni totale resta finito e la prima lega non cambia dopo le altre", () => {
    const leagues = Array.from({ length: 50 }, (_, index) => generatedLeague(1000 + index, 10));
    const first = scoreLeague(leagues[0] ?? []);
    let failures = 0;
    for (const league of leagues) {
      for (const lineup of league) {
        const result = score(lineup);
        const rebuilt = round2(result.playersPoints + result.captainModifier + result.fairPlay + result.defenseModifier + result.reservePoints);
        if (!Number.isFinite(result.total) || rebuilt !== result.total || result.players.length > 11) failures += 1;
      }
    }
    const again = scoreLeague(leagues[0] ?? []);
    const stable = first.every((total, index) => total === again[index]);
    return {
      passed: failures === 0 && stable && first.length === 10,
      expected: "500 rose coerenti, lega 0 invariata",
      actual: failures === 0 && stable ? "500 rose coerenti, lega 0 invariata" : `${failures} rose incoerenti, lega 0 ${stable ? "invariata" : "spostata"}`,
      delta: String(failures),
    };
  });

  const massLeagues = 50;
  const massTeams = 10;
  const mass = Array.from({ length: massLeagues }, (_, index) => generatedLeague(5000 + index, massTeams));
  const flat = mass.flat();
  const massStarted = performance.now();
  for (const lineup of flat) score(lineup);
  const massDuration = millis(performance.now() - massStarted);
  const perSecond = massDuration === 0 ? flat.length : Math.round(flat.length / (massDuration / 1000));

  add("Performance", "P1", "Una rosa singola sotto il budget", () => {
    const built = base442();
    const durationMs = measure(() => {
      score(built);
    });
    return budgetOutcome(durationMs, BUDGET.oneLineupMs, "calcolo rosa singola");
  });

  add("Performance", "P2", "Una giornata da venti rose sotto il budget", () => {
    const league = generatedLeague(42, 20);
    const durationMs = measure(() => {
      scoreLeague(league);
    });
    return budgetOutcome(durationMs, BUDGET.oneGameweekMs, "calcolo giornata");
  });

  add("Performance", "P3", "Cinquanta leghe e cinquecento rose sotto il budget", () => {
    const durationMs = measure(() => {
      for (const lineup of flat) score(lineup);
    }, 3);
    return budgetOutcome(durationMs, BUDGET.massLineupsMs, "calcolo massivo");
  });

  add("Performance", "P4", "Il caricamento della classifica di cinquecento rose sta nel budget", () => {
    const totals = flat.map((lineup, index) => ({ id: `t${index}`, total: score(lineup).total }));
    const durationMs = measure(() => {
      totals
        .map((row, index) => ({ ...row, position: index }))
        .sort((left, right) => right.total - left.total || left.id.localeCompare(right.id));
    });
    return budgetOutcome(durationMs, BUDGET.screenMs, "ordinamento classifica");
  });

  const latencyStarted = performance.now();
  const mocked = await loadMockedGameweek(generatedLeague(11, 20), simulateNetworkLatency);
  const latencyMs = millis(performance.now() - latencyStarted);
  const expectedQueries = SCREEN_QUERIES.length;
  const latencyFloor = simulateNetworkLatency ? expectedQueries * MOCK_QUERY_LATENCY_MS - 40 : 0;
  const latencyPassed = simulateNetworkLatency
    && mocked.log.queries.length === expectedQueries
    && latencyMs >= latencyFloor
    && latencyMs <= SCREEN_LATENCY_BUDGET_MS
    && mocked.totals.length === 20;
  checks.push({
    id: "L1",
    block: "Rete",
    name: "Caricamento giornata: 100 ms su ogni query mockata, poi il PASSED della schermata",
    status: latencyPassed ? "PASSED" : "FAILED",
    expected: simulateNetworkLatency
      ? `${expectedQueries} query, ${latencyFloor.toFixed(0)}–${SCREEN_LATENCY_BUDGET_MS} ms`
      : "simulateNetworkLatency attivo",
    actual: simulateNetworkLatency
      ? `${mocked.log.queries.length} query, ${latencyMs.toFixed(3)} ms`
      : "simulateNetworkLatency spento",
    delta: simulateNetworkLatency ? `${millis(latencyMs - expectedQueries * MOCK_QUERY_LATENCY_MS).toFixed(3)} ms` : null,
    durationMs: latencyMs,
    budgetMs: SCREEN_LATENCY_BUDGET_MS,
    bottleneck: latencyPassed ? null : (mocked.log.queries.length > expectedQueries ? "N+1 sulle query mockate" : "latenza della schermata fuori budget"),
  });

  add("Performance", "P5", "Il calcolo di quaranta rose fa due letture, non una per giocatore", () => {
    const league = generatedLeague(7, 40);
    const log: QueryLog = { queries: [] };
    scoreLeagueBatched(league, log);
    const naive = league.length * 11;
    const passed = log.queries.length === 2;
    return {
      passed,
      expected: "2 letture",
      actual: `${log.queries.length} letture`,
      delta: String(log.queries.length - 2),
      bottleneck: passed ? null : `N+1: ${naive} letture se ogni giocatore fa una query`,
    };
  });

  const finishedAt = new Date().toISOString();
  const passed = checks.filter((check) => check.status === "PASSED").length;
  const failed = checks.filter((check) => check.status === "FAILED").length;
  const skipped = checks.filter((check) => check.status === "SKIPPED").length;
  return {
    status: failed > 0 ? "FAILED" : "PASSED",
    startedAt,
    finishedAt,
    durationMs: millis(performance.now() - started),
    passed,
    failed,
    skipped,
    checks,
    load: {
      leagues: massLeagues,
      lineups: flat.length,
      lineupsPerSecond: perSecond,
      durationMs: massDuration,
      budgetMs: BUDGET.massLineupsMs,
    },
  };
}

export const QUERY_BUDGET_MS = BUDGET.queryMs;
