import { playingEleven, scoreLineup, type LineupSlotInput, type PlayerStat } from "../lib/engine/calculator";
import type { PlayerRole } from "../lib/types";

type Row = { id: string; role: PlayerRole; voto: number | null; benchOrder?: number };

function slot(row: Row): LineupSlotInput {
  return {
    playerId: row.id,
    role: row.role,
    isCaptain: false,
    isVice: false,
    benchOrder: row.benchOrder,
  };
}

function stat(row: Row): PlayerStat {
  return {
    playerId: row.id,
    role: row.role,
    voto: row.voto,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    penaltiesScored: 0,
    penaltiesMissed: 0,
    penaltiesSaved: 0,
    ownGoals: 0,
    goalsConceded: 0,
  };
}

function play(starters: Row[], bench: Row[]) {
  const rows = [...starters, ...bench];
  const slots = rows.map(slot);
  const stats = new Map(rows.map((row) => [row.id, stat(row)]));
  const trace = playingEleven(slots, stats, 11);
  const score = scoreLineup("rosa", slots, stats, { lineup_size: 11 });
  return { trace, score };
}

const failures: string[] = [];

function check(name: string, passed: boolean, actual: string) {
  if (passed) {
    console.log(`PASS ${name}`);
    return;
  }
  failures.push(`FAIL ${name}: ${actual}`);
  console.error(`FAIL ${name}: ${actual}`);
}

const base442: Row[] = [
  { id: "gk", role: "GK", voto: 6 },
  { id: "d1", role: "DEF", voto: 6 },
  { id: "d2", role: "DEF", voto: 6 },
  { id: "d3", role: "DEF", voto: 6 },
  { id: "d4", role: "DEF", voto: 6 },
  { id: "m1", role: "MID", voto: 6 },
  { id: "m2", role: "MID", voto: 6 },
  { id: "m3", role: "MID", voto: 6 },
  { id: "m4", role: "MID", voto: null },
  { id: "f1", role: "FWD", voto: 6 },
  { id: "f2", role: "FWD", voto: 6 },
];

const ordered = play(base442, [
  { id: "late", role: "MID", voto: 8, benchOrder: 2 },
  { id: "early", role: "MID", voto: 6, benchOrder: 1 },
  { id: "forward", role: "FWD", voto: 7, benchOrder: 3 },
]);
const firstStep = ordered.trace.trace.find((step) => step.starterId === "m4");
check(
  "Entra il primo centrocampista in ordine di panchina, non quello con il voto più alto",
  firstStep?.outcome === "same-role"
    && firstStep.entrantId === "early"
    && firstStep.benchOrder === 1
    && ordered.score.players.some((player) => player.playerId === "early")
    && !ordered.score.players.some((player) => player.playerId === "late"),
  firstStep ? `${firstStep.outcome} ${firstStep.entrantId} ordine ${firstStep.benchOrder}` : "nessun cambio",
);

const skipped = play(base442, [
  { id: "silent", role: "MID", voto: null, benchOrder: 1 },
  { id: "next", role: "MID", voto: 6.5, benchOrder: 2 },
]);
const skipStep = skipped.trace.trace.find((step) => step.starterId === "m4");
check(
  "Chi è prima in panchina senza voto viene saltato e entra il successivo dello stesso ruolo",
  skipStep?.outcome === "same-role" && skipStep.entrantId === "next" && skipStep.benchOrder === 2,
  skipStep ? `${skipStep.outcome} ${skipStep.entrantId} ordine ${skipStep.benchOrder}` : "nessun cambio",
);

const moduleSwitch = play(
  [
    { id: "gk", role: "GK", voto: 6 },
    { id: "d1", role: "DEF", voto: 6 },
    { id: "d2", role: "DEF", voto: 6 },
    { id: "d3", role: "DEF", voto: 6 },
    { id: "m1", role: "MID", voto: 6 },
    { id: "m2", role: "MID", voto: 6 },
    { id: "m3", role: "MID", voto: 6 },
    { id: "m4", role: "MID", voto: null },
    { id: "f1", role: "FWD", voto: 6 },
    { id: "f2", role: "FWD", voto: 6 },
    { id: "f3", role: "FWD", voto: 6 },
  ],
  [
    { id: "extra-fwd", role: "FWD", voto: 7, benchOrder: 1 },
    { id: "extra-def", role: "DEF", voto: 6, benchOrder: 2 },
  ],
);
const switchStep = moduleSwitch.trace.trace.find((step) => step.starterId === "m4");
check(
  "Se il ruolo non si completa, entra il primo cambio di modulo ancora valido",
  switchStep?.outcome === "module-switch"
    && switchStep.entrantId === "extra-def"
    && switchStep.benchOrder === 2
    && moduleSwitch.score.players.some((player) => player.playerId === "extra-def")
    && !moduleSwitch.score.players.some((player) => player.playerId === "extra-fwd"),
  switchStep ? `${switchStep.outcome} ${switchStep.entrantId} ordine ${switchStep.benchOrder}` : "nessun cambio",
);

if (failures.length > 0) process.exit(1);
console.log("Sostituzioni e modulo: PASSED 3/3");
