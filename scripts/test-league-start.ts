// Giornata di inizio di una lega e impostazioni scelte alla creazione. Solo dati inventati.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { defaultPhases, inLeagueRange, newLeagueRange, parseLeagueRules, DEFAULT_LEAGUE_RULES, scoringPhase } from "../lib/league-rules";

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
  check("La coppa parte dove scelto", scoringPhase(chosen, 31).kind === "knockout" && scoringPhase(chosen, 13).kind === "regular");

  return { total, passed: total - failures.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = runLeagueStartChecks();
  console.log(`Inizio lega: ${result.passed}/${result.total}`);
  for (const failure of result.failures) console.log(`- ${failure}`);
  if (result.failures.length > 0) process.exit(1);
}
