// Dashboard: quale giornata è in corso e quale si può ancora schierare. Nessuna rete.
import { pathToFileURL } from "node:url";
import { currentRounds, type WeekMatchState } from "@/lib/server/roster";

const NOW = Date.parse("2026-11-28T15:00:00Z");
const week = (number: number, deadline: string, status = "open") => ({ number, status, deadline_at: deadline });
const state = (inPlay: number[], finished: number[] = []): WeekMatchState => ({
  inPlay: new Set(inPlay),
  withMatches: new Set([12, 13, 14]),
  finished: new Set(finished),
});
const past = "2026-11-27T19:44:00Z";
const later = "2026-11-28T19:00:00Z";
const future = "2026-12-05T14:00:00Z";
const season = (status = "locked", deadline = past) => [
  week(12, "2026-11-20T19:44:00Z", "scored"),
  week(13, deadline, status),
  week(14, future),
];

export function runHomeRoundChecks() {
  const cases: { name: string; pass: boolean }[] = [];
  const check = (name: string, weeks: ReturnType<typeof season>, matches: WeekMatchState, live: number | null, upcoming: number | null) => {
    const found = currentRounds(weeks, NOW, matches);
    cases.push({ name, pass: (found.live?.number ?? null) === live && (found.upcoming?.number ?? null) === upcoming });
  };
  check("prima della deadline si schiera", season("open", later), state([]), null, 13);
  check("a partite in corso c'è il Live", season(), state([13]), 13, 14);
  check("tra deadline e calcio d'inizio c'è il Live", season(), state([]), 13, 14);
  check("primo calcio d'inizio anticipato: Live", season("open", later), state([13]), 13, 13);
  check("finite tutte le partite si schiera la prossima", season(), state([], [13]), null, 14);
  check("giornata calcolata: niente Live", season("scored"), state([13]), null, 14);
  check("lega che inizia più avanti: niente Live", [week(14, future)], state([13]), null, 14);
  const failures = cases.filter((item) => !item.pass).map((item) => item.name);
  return { total: cases.length, passed: cases.length - failures.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runHomeRoundChecks();
  console.log(`${result.failures.length === 0 ? "PASSED" : "FAILED"} ${result.passed}/${result.total}`);
  for (const failure of result.failures) console.log(`- ${failure}`);
  process.exit(result.failures.length === 0 ? 0 : 1);
}
