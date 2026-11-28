// Giornata di inizio di una lega e impostazioni scelte alla creazione. Solo dati inventati.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { entryCredit, lateEntryOf, presentAverage, waitingWeek, weekGain } from "../lib/late-entry";
import { BONUS_FIELDS, defaultPhases, inLeagueRange, newLeagueRange, parseLeagueRules, DEFAULT_LEAGUE_RULES, scoringPhase } from "../lib/league-rules";
import { readFileSync } from "node:fs";

export function runLeagueStartChecks() {
  let total = 0;
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };
  const same = (value: unknown, expected: unknown) => JSON.stringify(value) === JSON.stringify(expected);

  check("Inizio dalla prossima giornata", same(newLeagueRange(13, 38, 13, 38), { from: 13, to: 38 }));
  check("Senza ultima giornata vale la fine", same(newLeagueRange(15, undefined, 13, 38), { from: 15, to: 38 }));
  check("Giornata già chiusa rifiutata", typeof newLeagueRange(12, 38, 13, 38) === "string");
  check("Senza giornata di inizio rifiutata", newLeagueRange(null, 38, 13, 38) === "Scegli la giornata da cui parte la lega.");
  check("Fine oltre il calendario rifiutata", typeof newLeagueRange(13, 39, 13, 38) === "string");
  check("Fine prima dell'inizio rifiutata", typeof newLeagueRange(20, 19, 13, 38) === "string");
  check("Valori non interi rifiutati", typeof newLeagueRange(13.5, 38, 13, 38) === "string");
  check("Le giornate prima dell'inizio non contano", !inLeagueRange({ from: 13, to: 38 }, 12) && inLeagueRange({ from: 13, to: 38 }, 13));

  const hybrid = defaultPhases("hybrid", 13, 38);
  check("Fasi dalla 13: regular 13-30 e coppa 31-38", same(hybrid.map((p) => [p.kind, p.fromMatchday, p.toMatchday]), [["regular", 13, 30], ["knockout", 31, 38]]));
  const late = defaultPhases("hybrid", 35, 38);
  check("Fasi con poche giornate: nessun buco e nessuna fase rovesciata", late.every((p) => p.fromMatchday <= p.toMatchday) && late[0].fromMatchday === 35 && late.at(-1)?.toMatchday === 38 && late[1]?.fromMatchday === late[0].toMatchday + 1);
  check("Una sola giornata: una sola fase", defaultPhases("hybrid", 38, 38).length === 1);
  check("Senza giornate indicate restano 1-38", same(defaultPhases("hybrid").map((p) => [p.fromMatchday, p.toMatchday]), [[1, 30], [31, 38]]));

  const chosen = parseLeagueRules({
    ...DEFAULT_LEAGUE_RULES,
    format: "hybrid",
    phases: hybrid,
    captainMultiplier: 2,
    missedLineup: "penalty",
    missedLineupPenalty: 5,
    cleanSheetEnabled: true,
    cleanSheetPoints: 2,
    bonusEnabled: { ...DEFAULT_LEAGUE_RULES.bonusEnabled, goal_conceded: false },
    checkpoints: [{ afterMatchday: 19, changes: 4 }],
    goalBands: [{ min: 65, goals: 1 }],
  }, "hybrid");
  check(
    "Le impostazioni scelte restano sulla lega",
    chosen.captainMultiplier === 2 && chosen.missedLineup === "penalty" && chosen.missedLineupPenalty === 5
      && chosen.cleanSheetEnabled && chosen.cleanSheetPoints === 2 && chosen.bonusEnabled.goal_conceded === false
      && same(chosen.checkpoints, [{ afterMatchday: 19, changes: 4 }]) && same(chosen.goalBands, [{ min: 65, goals: 1 }])
      && same(chosen.phases, hybrid),
  );
  check("Lega nuova: l'imbattibilità del portiere parte accesa e vale 1", DEFAULT_LEAGUE_RULES.cleanSheetEnabled && parseLeagueRules(undefined).cleanSheetEnabled && parseLeagueRules({}).cleanSheetPoints === 1);
  check("Chi la spegne la trova spenta", parseLeagueRules({ ...DEFAULT_LEAGUE_RULES, cleanSheetEnabled: false }).cleanSheetEnabled === false);
  // Ogni opzione della lega si sceglie creandola: una regola nuova senza il suo comando qui fa fallire la prova.
  const source = (path: string) => readFileSync(path, "utf8");
  const form = source("components/leagues/CreateLeagueForm.tsx");
  const automatic = ["ranking", "budget", "phases", "scoringHistory"]; // seguono la modalità, il valore fisso, le giornate o il server
  const unasked = Object.keys(DEFAULT_LEAGUE_RULES)
    .filter((key) => !automatic.includes(key) && !new RegExp(String.raw`change\(\{[^}]*\b${key}\b`).test(form));
  check("Creando una lega si chiede ogni opzione", unasked.length === 0, unasked.join(", "));
  check("Creando una lega si scelgono nome, giornate e fasi", /setName\(/.test(form) && /changeRange\(value, pickedEnd\)/.test(form) && /changeRange\(pickedStart, value\)/.test(form) && /rules: \{ \.\.\.rules, phases \}/.test(form));
  const onboarding = source("components/home/LeagueOnboarding.tsx");
  check("Dalla Home si crea solo con il modulo completo", onboarding.includes('href="/leghe?nuova=1"') && !/fetch\("\/api\/leagues",/.test(onboarding));
  const custom = parseLeagueRules({
    format: "hybrid", visibility: "public", enrollment: "closed", maxMembers: 6, defenseEnabled: false, captainEnabled: false,
    captainMultiplier: 1.5, missedLineup: "penalty", missedLineupPenalty: 4.5, cleanSheetEnabled: false, cleanSheetPoints: 2.5,
    bonusEnabled: Object.fromEntries(BONUS_FIELDS.map((field) => [field.key, false])),
    bonusMalus: Object.fromEntries(BONUS_FIELDS.map((field, index) => [field.key, index + 0.5])),
    exclusiveRosters: true, checkpoints: [{ afterMatchday: 20, changes: 2 }], postponement: "political_six",
    goalBands: [{ min: 60, goals: 1 }], phases: hybrid,
  });
  const lost = (Object.keys(DEFAULT_LEAGUE_RULES) as (keyof typeof DEFAULT_LEAGUE_RULES)[])
    .filter((key) => !["ranking", "budget", "scoringHistory"].includes(key) && same(custom[key], DEFAULT_LEAGUE_RULES[key]));
  check("Nessuna opzione scelta torna al valore di partenza", lost.length === 0, lost.join(", "));

  check("La coppa parte dove scelto", scoringPhase(chosen, 31).kind === "knockout" && scoringPhase(chosen, 13).kind === "regular");

  // Ingresso in corsa: A, B e C dalla giornata 1; D entra alla 3; E non ha mai schierato.
  const weeks = [1, 2, 3].map((number) => ({ id: `g${number}`, number }));
  const table: Record<string, number> = { "A:g1": 60, "B:g1": 70, "C:g1": 80, "A:g2": 50, "B:g2": 0, "C:g2": 70, "A:g3": 61, "B:g3": 62, "C:g3": 63, "D:g3": 90 };
  const pointsOf = (teamId: string, weekId: string) => table[`${teamId}:${weekId}`] ?? 0;
  const entry = { teamIds: ["A", "B", "C", "D", "E"], entryByTeam: new Map([["A", 1], ["B", 1], ["C", 1], ["D", 3]]), startMatchday: 1, allowed: true };
  const credit = entryCredit(entry, "D", weeks, pointsOf);
  check("Media di ingresso: solo le squadre già in gioco, senza la propria", credit.points === 110 && credit.skipped === 2 && credit.average === 55, JSON.stringify(credit));
  check("Chi era in gioco e non ha fatto punti conta zero", presentAverage(entry, 2, (id) => pointsOf(id, "g2")) === 40);
  check("Chi non ha mai schierato non conta e non è un ingresso", lateEntryOf(entry, "E") === null && entryCredit(entry, "E", weeks, pointsOf).points === 0);
  check("Chi c'era dall'inizio non riceve niente", entryCredit(entry, "A", weeks, pointsOf).points === 0);
  const fielded = new Set(["A:g1", "A:g2", "A:g3", "D:g3"]);
  const season = (teamId: string) => weeks.reduce((sum, week) => sum + weekGain(entry, fielded, teamId, week, (id) => pointsOf(id, week.id)), 0);
  check("Totale di chi entra: medie saltate più i propri punti", season("D") === 200, String(season("D")));
  check("Totale di chi c'era: solo i propri punti", season("A") === 171, String(season("A")));
  const second = { ...entry, teamIds: ["A", "D"], entryByTeam: new Map([["A", 1], ["D", 3]]) };
  check("Con due sole squadre la media è l'altra", entryCredit(second, "D", weeks, pointsOf).points === 110);
  check("Lega a numero chiuso: nessun punto di ingresso", entryCredit({ ...entry, allowed: false }, "D", weeks, pointsOf).points === 0);
  const from13 = { ...entry, startMatchday: 3 };
  check("Entrare alla giornata di inizio della lega non è un ingresso in corsa", lateEntryOf(from13, "D") === null);

  const joined = { ...entry, waiting: new Map([["E", 4]]) };
  const early = entryCredit(joined, "E", weeks, pointsOf);
  check("Appena iscritto, senza formazioni: riceve subito la media", lateEntryOf(joined, "E") === 4 && early.skipped === 3 && early.points > 0, JSON.stringify(early));
  check("Appena iscritto: non entra nella media degli altri", entryCredit(joined, "D", weeks, pointsOf).points === credit.points);
  check("La prima formazione vale più della data di iscrizione", lateEntryOf({ ...entry, waiting: new Map([["D", 2]]) }, "D") === 3);
  check("Iscritto dopo la chiusura: parte dalla giornata della sua rosa", waitingWeek(14, 14, 1) === 14);
  check("Iscritto senza rosa: parte dalla prima giornata ancora aperta", waitingWeek(null, 13, 1) === 13);
  check("In rosa dall'inizio e mai schierato: non è un ingresso in corsa", waitingWeek(1, 13, 1) === null);
  check("Lega che parte adesso: nessun ingresso in corsa", waitingWeek(null, 13, 13) === null && waitingWeek(1, 13, 13) === null);

  return { total, passed: total - failures.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = runLeagueStartChecks();
  console.log(`Inizio lega: ${result.passed}/${result.total}`);
  for (const failure of result.failures) console.log(`- ${failure}`);
  if (result.failures.length > 0) process.exit(1);
}
