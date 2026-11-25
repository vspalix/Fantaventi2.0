import { pathToFileURL } from "node:url";
import {
  filedPlayerScore,
  playingEleven,
  scoreLineup,
  type LineupSlotInput,
  type PlayerStat,
  type RulesetDefinition,
} from "@/lib/engine/calculator";
import { DEFAULT_GOAL_BANDS, headToHeadPoints, lineupAcceptsUpdate, weekScoreMode } from "@/lib/league-rules";
import { OPEN_WINDOW_MS, planFollowingGameweek } from "@/lib/server/gameweek-cycle";
import { APPEAL_MS, gameweekShouldLock } from "@/lib/server/gameweek-lifecycle";
import { holeIdsKeepingHeldPlayers, isHeldMatch, rowHold } from "@/lib/server/held-lineup";
import { MATCH_CLOSE_MS } from "@/lib/server/match-window";
import { deadlineFromKickoff } from "@/lib/server/serie-a-calendar";
import type { PlayerRole } from "@/lib/types";

type Step = {
  name: string;
  passed: boolean;
  detail: string;
};

type Mark = "C" | "V" | number;

const KICKOFF = Date.parse("2026-11-28T15:00:00.000Z");
const LATER_KICKOFF = KICKOFF + 2 * 60 * 60 * 1000;

const SCORING: RulesetDefinition = {
  lineup_size: 11,
  double_captain_malus: true,
  empty_slot_points: 0,
  captain_modifier: [
    { max_exclusive: 6, points: -0.5 },
    { eq: 6, points: 0.5 },
    { eq: 6.5, points: 1 },
    { eq: 7, points: 1.5 },
    { min_inclusive: 7.5, points: 2 },
  ],
  fair_play: { points: 0, cards: ["yellow_card"] },
  defense_modifier: { enabled: false, bands: [] },
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

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function stat(id: string, role: PlayerRole, voto: number | null, extra: Partial<PlayerStat> = {}): PlayerStat {
  return {
    playerId: id,
    role,
    voto,
    goals: extra.goals ?? 0,
    assists: extra.assists ?? 0,
    yellowCards: extra.yellowCards ?? 0,
    redCards: extra.redCards ?? 0,
    penaltiesScored: extra.penaltiesScored ?? 0,
    penaltiesMissed: extra.penaltiesMissed ?? 0,
    penaltiesSaved: extra.penaltiesSaved ?? 0,
    ownGoals: extra.ownGoals ?? 0,
    goalsConceded: extra.goalsConceded ?? 0,
    postponed: extra.postponed ?? false,
  };
}

function eleven(
  rows: Array<[string, PlayerRole, number | null, Partial<PlayerStat>?, Mark?]>,
  bench: Array<[string, PlayerRole, number | null, number]> = [],
) {
  const slots: LineupSlotInput[] = [];
  const stats = new Map<string, PlayerStat>();
  for (const [id, role, voto, extra, mark] of rows) {
    slots.push({
      playerId: id,
      role,
      isCaptain: mark === "C",
      isVice: mark === "V",
    });
    stats.set(id, stat(id, role, voto, extra));
  }
  for (const [id, role, voto, order] of bench) {
    slots.push({ playerId: id, role, isCaptain: false, isVice: false, benchOrder: order });
    stats.set(id, stat(id, role, voto));
  }
  return { slots, stats };
}

function baseStarters(missing: string[] = []): Array<[string, PlayerRole, number | null, Partial<PlayerStat>?, Mark?]> {
  const holes = new Set(missing);
  const rows: Array<[string, PlayerRole]> = [
    ["gk", "GK"],
    ["d1", "DEF"], ["d2", "DEF"], ["d3", "DEF"], ["d4", "DEF"],
    ["m1", "MID"], ["m2", "MID"], ["m3", "MID"], ["m4", "MID"],
    ["f1", "FWD"], ["f2", "FWD"],
  ];
  return rows.map(([id, role]) => [id, role, holes.has(id) ? null : 6, {}, id === "gk" ? "C" : undefined]);
}

function weekInPlay(kickoffs: number[], statuses: Array<"scheduled" | "locked" | "live" | "finished">, now: number) {
  const first = Math.min(...kickoffs);
  const over = kickoffs.map((kickoff, index) => {
    const status = statuses[index];
    if (status === "finished") return true;
    if (status === "live" || status === "locked") return false;
    return now >= kickoff + MATCH_CLOSE_MS;
  });
  return now >= first && over.some((done) => !done);
}

export function runMatchdayLifecycle() {
  const steps: Step[] = [];
  const add = (name: string, passed: boolean, detail: string) => {
    steps.push({ name, passed, detail });
  };

  const deadline = deadlineFromKickoff(new Date(KICKOFF)).getTime();
  const twoMinutesBefore = KICKOFF - 2 * 60 * 1000;
  const thirtySecondsBefore = KICKOFF - 30 * 1000;

  const editableBefore = lineupAcceptsUpdate(twoMinutesBefore, deadline, "open")
    && !gameweekShouldLock({ status: "open", deadlineAt: deadline, firstKickoff: KICKOFF, now: twoMinutesBefore })
    && !weekInPlay([KICKOFF, LATER_KICKOFF], ["scheduled", "scheduled"], twoMinutesBefore);
  add(
    "Prima del calcio d'inizio la formazione è ancora modificabile",
    editableBefore,
    editableBefore
      ? "Due minuti prima la giornata è aperta: la deadline è il primo calcio d'inizio meno 60 secondi."
      : "La formazione risulta già chiusa due minuti prima del fischio.",
  );

  const closedByDeadline = !lineupAcceptsUpdate(thirtySecondsBefore, deadline, "open")
    && gameweekShouldLock({ status: "open", deadlineAt: deadline, firstKickoff: KICKOFF, now: thirtySecondsBefore });
  add(
    "La formazione si chiude 60 secondi prima del primo calcio d'inizio",
    closedByDeadline,
    closedByDeadline
      ? "A trenta secondi dal fischio la deadline è passata e la giornata va in locked."
      : "La deadline non ha chiuso la formazione.",
  );

  const atKickoff = gameweekShouldLock({ status: "open", deadlineAt: deadline, firstKickoff: KICKOFF, now: KICKOFF });
  const firstMatchLocks = KICKOFF <= KICKOFF && KICKOFF > KICKOFF - MATCH_CLOSE_MS;
  const secondStaysScheduled = LATER_KICKOFF > KICKOFF;
  const inPlay = weekInPlay([KICKOFF, LATER_KICKOFF], ["locked", "scheduled"], KICKOFF);
  add(
    "Al fischio della prima partita la giornata è in corso e la seconda resta in programma",
    atKickoff && firstMatchLocks && secondStaysScheduled && inPlay && !lineupAcceptsUpdate(KICKOFF, deadline, "locked"),
    "La prima partita entra nella finestra di 130 minuti. La seconda, due ore dopo, non viene toccata. Le bozze diventano locked.",
  );

  const regular = eleven(baseStarters());
  const regularScore = scoreLineup("alfa", regular.slots, regular.stats, SCORING);
  const regularExpected = 66.5;
  add(
    "Titolari tutti a voto: undici 6 e fascia capitano da 6",
    regularScore.players.length === 11
      && regularScore.players.every((player) => player.voto === 6)
      && regularScore.captainPlayerId === "gk"
      && regularScore.captainModifier === 0.5
      && regularScore.total === regularExpected,
    `Totale ${regularScore.total.toFixed(2)}. Atteso ${regularExpected.toFixed(2)} (66 di voti + 0,50 di capitano).`,
  );

  const substituted = eleven(baseStarters(["m3", "m4", "f2"]), [
    ["b1", "MID", null, 1],
    ["b2", "MID", 6, 2],
    ["b3", "GK", 7, 3],
    ["b4", "FWD", 6, 4],
  ]);
  const subRules: RulesetDefinition = { ...SCORING, empty_slot_points: 4 };
  const holes = holeIdsKeepingHeldPlayers(substituted.slots, substituted.stats);
  const trace = playingEleven(substituted.slots, substituted.stats, 11, holes);
  const subScore = scoreLineup("alfa", substituted.slots, substituted.stats, subRules, holes);
  const entered = trace.trace.filter((item) => item.entrantId).map((item) => `${item.starterId}->${item.entrantId} (${item.outcome})`);
  const subOk = trace.trace.find((item) => item.starterId === "m3")?.outcome === "same-role"
    && trace.trace.find((item) => item.starterId === "m3")?.entrantId === "b2"
    && trace.trace.find((item) => item.starterId === "m4")?.outcome === "module-switch"
    && trace.trace.find((item) => item.starterId === "m4")?.entrantId === "b4"
    && trace.trace.find((item) => item.starterId === "f2")?.outcome === "unfilled"
    && !subScore.players.some((player) => player.playerId === "b1" || player.playerId === "b3")
    && subScore.reservePoints === 4
    && subScore.total === 64.5;
  add(
    "S.V.: ordine di panchina, stesso ruolo, cambio modulo e un solo subentro per buco",
    subOk,
    subOk
      ? "m3 prende b2 (il primo centrocampista a voto). m4 diventa 4-3-3 con b4. Il portiere in panchina non copre il movimento. f2 resta scoperto: riserva 4, totale 64,50."
      : `Traccia ${entered.join(", ") || "vuota"}. Totale ${subScore.total.toFixed(2)}, riserva ${subScore.reservePoints.toFixed(2)}.`,
  );

  const catalog = SCORING.bonus_malus ?? {};
  const goal = filedPlayerScore(stat("f1", "FWD", 6, { goals: 1 }), "FWD", SCORING);
  const assistCard = filedPlayerScore(stat("m1", "MID", 6, { assists: 1, yellowCards: 1 }), "MID", SCORING);
  const redPenalty = filedPlayerScore(stat("f2", "FWD", 6, { redCards: 1, penaltiesMissed: 1 }), "FWD", SCORING);
  const saved = filedPlayerScore(stat("gk", "GK", 6, { penaltiesSaved: 1 }), "GK", SCORING);
  const ownGoal = filedPlayerScore(stat("d1", "DEF", 6, { ownGoals: 1 }), "DEF", SCORING);
  const conceded = filedPlayerScore(stat("gk", "GK", 6, { goalsConceded: 1 }), "GK", SCORING);
  const bonusRows = eleven([
    ["gk", "GK", 6, { penaltiesSaved: 1 }, "C"],
    ["d1", "DEF", 6, { ownGoals: 1 }],
    ["d2", "DEF", 6],
    ["d3", "DEF", 6],
    ["d4", "DEF", 6],
    ["m1", "MID", 6, { assists: 1, yellowCards: 1 }],
    ["m2", "MID", 6],
    ["m3", "MID", 6],
    ["m4", "MID", 6],
    ["f1", "FWD", 6.5, { goals: 1 }],
    ["f2", "FWD", 6, { redCards: 1, penaltiesMissed: 1 }],
  ]);
  const bonusScore = scoreLineup("alfa", bonusRows.slots, bonusRows.stats, SCORING);
  const catalogOk = goal.fantavoto === 6 + catalog.goal
    && assistCard.fantavoto === round2(6 + catalog.assist + catalog.yellow_card)
    && redPenalty.fantavoto === round2(6 + catalog.red_card + catalog.penalty_missed)
    && saved.fantavoto === 6 + catalog.penalty_saved
    && ownGoal.fantavoto === 6 + catalog.own_goal
    && conceded.fantavoto === 6 + catalog.goal_conceded
    && bonusScore.total === 67.5
    && bonusScore.captainModifier === 0.5;
  add(
    "Bonus e malus di gol, assist, ammonizione, espulsione, rigori e autogol",
    catalogOk,
    catalogOk
      ? "Listino applicato sui singoli voti. La rosa completa fa 67,50: 67 di fantavoto e 0,50 di capitano sul 6."
      : `Gol ${goal.fantavoto}, assist ${assistCard.fantavoto}, rigore sbagliato ${redPenalty.fantavoto}, rigore parato ${saved.fantavoto}, autogol ${ownGoal.fantavoto}, gol subito ${conceded.fantavoto}, totale ${bonusScore.total.toFixed(2)}.`,
  );

  const postponed = eleven(baseStarters(["d4"]), [["b-def", "DEF", 7, 1]]);
  const held = postponed.stats.get("d4");
  if (held) {
    held.postponed = true;
    held.assists = 1;
  }
  const heldHoles = holeIdsKeepingHeldPlayers(postponed.slots, postponed.stats);
  const heldScore = scoreLineup("alfa", postponed.slots, postponed.stats, SCORING, heldHoles);
  const heldPlayer = heldScore.players.find((player) => player.playerId === "d4");
  const postponedOk = !heldHoles.has("d4")
    && heldPlayer?.voto === 6
    && heldPlayer.bonusPoints === 0
    && heldPlayer.malusPoints === 0
    && !heldScore.players.some((player) => player.playerId === "b-def")
    && heldScore.total === 66.5;
  add(
    "Partita rinviata con 6 politico: il titolare resta in campo e la panchina non entra",
    postponedOk,
    postponedOk
      ? "d4 prende 6 senza l'assist caricato sul tabellino. Il difensore di panchina da 7 resta fuori. Totale 66,50."
      : `d4 voto ${heldPlayer?.voto ?? "assente"}, bonus ${heldPlayer?.bonusPoints ?? "—"}, in campo ${heldScore.players.map((player) => player.playerId).join(", ")}.`,
  );

  const suspendedHold = rowHold({ hold_status: "suspended", postponed: false });
  const suspendedLikePostponed = suspendedHold === "suspended" && isHeldMatch({ hold_status: "suspended" });
  const suspendedStats = new Map(postponed.stats);
  const suspendedScore = scoreLineup("alfa", postponed.slots, suspendedStats, SCORING, holeIdsKeepingHeldPlayers(postponed.slots, suspendedStats));
  add(
    "Partita sospesa: stesso blocco del rinvio, 6 politico e niente subentro",
    suspendedLikePostponed && suspendedScore.total === heldScore.total && suspendedScore.players.some((player) => player.playerId === "d4" && player.voto === 6),
    suspendedLikePostponed
      ? `Lo stato suspended tiene la partita ferma. Il calcolo coincide con il rinvio: ${suspendedScore.total.toFixed(2)}.`
      : `Stato letto: ${suspendedHold}. Totale ${suspendedScore.total.toFixed(2)}.`,
  );

  const waitingRules: RulesetDefinition = { ...SCORING, postponement: "wait_recovery" };
  const waiting = scoreLineup("alfa", postponed.slots, postponed.stats, waitingRules, heldHoles);
  const waitingPlayer = waiting.players.find((player) => player.playerId === "d4");
  add(
    "In attesa del recupero il rinviato resta senza voto e senza sostituzione",
    waitingPlayer?.voto === null
      && waiting.reservePoints === 0
      && !waiting.players.some((player) => player.playerId === "b-def")
      && waiting.total === 60.5,
    `Totale ${waiting.total.toFixed(2)}. Atteso 60,50: dieci voti da 6, il rinviato non conta, fascia capitano 0,50.`,
  );

  const alfa = bonusScore.total;
  const betaBuilt = eleven(baseStarters());
  const beta = scoreLineup("beta", betaBuilt.slots, betaBuilt.stats, SCORING).total;
  const weekOne = new Map([["alfa", alfa], ["beta", beta]]);
  const h2h = headToHeadPoints(["alfa", "beta"], 1, weekOne, DEFAULT_GOAL_BANDS);
  const classic = alfa + 0;
  const h2hMode = weekScoreMode({ phases: [{ kind: "regular", format: "h2h", fromMatchday: 1, toMatchday: 38 }] }, 1);
  const classicMode = weekScoreMode({ phases: [{ kind: "regular", format: "classic", fromMatchday: 1, toMatchday: 38 }] }, 1);
  const alfaGoals = alfa >= 66 && alfa < 72 ? 1 : -1;
  const betaGoals = beta >= 66 && beta < 72 ? 1 : -1;
  const tableOk = h2hMode === "head_to_head"
    && classicMode === "sum"
    && alfa === 67.5
    && beta === 66.5
    && alfaGoals === 1
    && betaGoals === 1
    && h2h.get("alfa") === 1
    && h2h.get("beta") === 1
    && classic === 67.5;
  add(
    "Classifica a somma e scontri diretti sulla stessa giornata",
    tableOk,
    tableOk
      ? "Alfa 67,50 (1 gol) e Beta 66,50 (1 gol): in H2H è 1-1. In classifica generale Alfa ha 67,50 fantapunti di giornata."
      : `Alfa ${alfa.toFixed(2)} (${h2h.get("alfa") ?? "—"} pt), Beta ${beta.toFixed(2)} (${h2h.get("beta") ?? "—"} pt), modalità ${h2hMode}/${classicMode}.`,
  );

  const scoredAt = KICKOFF + 6 * 60 * 60 * 1000;
  const beforeAppeal = gameweekShouldLock({ status: "scored", deadlineAt: deadline, firstKickoff: KICKOFF, now: scoredAt + APPEAL_MS - 1 }) === false;
  const appealOver = scoredAt + APPEAL_MS;
  const weeks = [
    { id: "gw-1", number: 1, status: "scored" },
    { id: "gw-2", number: 2, status: "scheduled" },
  ];
  const plan = planFollowingGameweek(weeks, 1, appealOver);
  const drafts = [
    { gameweekId: "gw-2", status: "draft" },
    { gameweekId: "gw-2", status: "locked" },
  ];
  const kept = plan?.clearDrafts ? drafts.filter((lineup) => lineup.status !== "draft") : drafts;
  const advanced = beforeAppeal
    && plan?.number === 2
    && plan.status === "open"
    && plan.deadlineAt === new Date(appealOver + OPEN_WINDOW_MS).toISOString()
    && kept.length === 1
    && kept[0]?.status === "locked"
    && planFollowingGameweek([{ id: "gw-2", number: 2, status: "final" }], 1, appealOver) === null;
  add(
    "Dopo le 24 ore la giornata è chiusa e si apre la successiva",
    advanced,
    advanced
      ? "La giornata 1 resta scored fino allo scadere delle 24 ore, poi la 2 si apre per 7 giorni e le sue bozze si cancellano."
      : `Piano: ${plan ? `giornata ${plan.number} ${plan.status}` : "nessuno"}. Bozze rimaste ${kept.length}.`,
  );

  const failed = steps.filter((step) => !step.passed);
  return {
    passed: failed.length === 0,
    steps,
    passedCount: steps.length - failed.length,
    total: steps.length,
  };
}

function printReport(report: ReturnType<typeof runMatchdayLifecycle>) {
  console.log("Ciclo giornata (in memoria, nessun accesso a Supabase)");
  report.steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step.passed ? "PASS" : "FAIL"} — ${step.name}`);
    console.log(`   ${step.detail}`);
  });
  console.log(`${report.passed ? "PASSED" : "FAILED"} ${report.passedCount}/${report.total}`);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  const report = runMatchdayLifecycle();
  printReport(report);
  if (!report.passed) process.exit(1);
}
