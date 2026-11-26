// Letture dei voti con orologio finto, pagine finte e database in memoria. Nessuna rete.
import { pathToFileURL } from "node:url";
import { readVotePage } from "@/lib/server/fantacalcio-live";
import { runManualRead, runVoteCycle, type ClockDeps, type CycleReport } from "@/lib/server/vote-engine";
import {
  planIsEmpty,
  planVoteClock,
  romeParts,
  romeTime,
  type ClockMatch,
  type ClockSnapshot,
  type ClockWeek,
  type ReadRow,
} from "@/lib/server/vote-schedule";

type Case = { name: string; pass: boolean; detail: string };

const MINUTE = 60_000;
/** Minuti della sveglia delle partite, ore 13-23. La mattina suona alle 8:00 e 8:30. */
// Se cambia la sveglia in .cursorrules, vanno aggiornati anche questi.
const MATCH_MINUTES = [0, 5, 15, 20, 30, 35, 45, 50];

const at = (date: string, clock: string) => {
  const [hour, minute] = clock.split(":").map(Number);
  return romeTime(date, hour, minute);
};

const ROUND: [string, string][] = [
  ["2026-11-27", "20:45"],
  ["2026-11-28", "15:00"], ["2026-11-28", "18:00"], ["2026-11-28", "20:45"],
  ["2026-11-29", "12:30"], ["2026-11-29", "15:00"], ["2026-11-29", "15:00"], ["2026-11-29", "18:00"], ["2026-11-29", "20:45"],
  ["2026-11-30", "20:45"],
];
const DAYS = ["2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"];

function weekOf(times: [string, string][], number = 12): ClockWeek {
  return {
    id: `week-${number}`,
    number,
    status: "scheduled",
    seasonCode: "2026-27",
    matches: times.map(([date, clock], index) => ({
      id: `m${index}`,
      kickoffAt: new Date(at(date, clock)).toISOString(),
      status: "scheduled",
      home: `casa${index}`,
      away: `ospite${index}`,
      homeClubId: `h${index}`,
      awayClubId: `a${index}`,
      postponed: false,
      holdStatus: "none",
      holdKickoffAt: null,
    })),
  };
}

type Source = (match: ClockMatch, now: number) => { grades: [number, number]; status: number | null; score: boolean };

const normalSource: Source = (match, now) => {
  const age = (now - new Date(match.kickoffAt).getTime()) / MINUTE;
  if (age < 45) return { grades: [0, 0], status: 1, score: false };
  if (age < 112) return { grades: [11, 11], status: 2, score: true };
  return { grades: [15, 14], status: 4, score: true };
};
const silentSource: Source = () => ({ grades: [0, 0], status: 1, score: false });

/** La stessa forma della pagina vera: righe dei calciatori e riquadri delle partite. */
function fakePage(week: ClockWeek, source: Source, now: number) {
  let rows = "";
  let blocks = "";
  week.matches.forEach((match, index) => {
    const state = source(match, now);
    [match.home, match.away].forEach((club, side) => {
      for (let player = 0; player < state.grades[side]; player += 1) {
        const bonus = '<span class="player-bonus" data-value="0"></span>'.repeat(7);
        rows += `<tr><td><a href="https://finta.test/serie-a/squadre/${club}/giocatore/${index * 100 + side * 40 + player + 1}">x</a></td>`
          + `<td><span class="player-grade" data-value="6,5"></span>${bonus}</td></tr>`;
      }
    });
    const attribute = state.status === null ? "" : ` data-match-status="${state.status}"`;
    const score = state.score ? '<span class="score-home">1</span>-<span class="score-away">0</span>' : "";
    blocks += `<li id="match-${index + 1}" class="match"><div class="match-pill"${attribute}>`
      + `<a href="https://finta.test/serie-a/calendario/12/2026-27/${match.home}-${match.away}/${index + 1}">${score}</a></div></li>`;
  });
  return readVotePage(200, `<html><ul>${blocks}</ul><table>${rows}</table></html>`);
}

function harness(week: ClockWeek, options: { source?: Source; halftime?: boolean; auto?: boolean; failFetch?: boolean; failCalc?: boolean } = {}) {
  const state = {
    now: 0,
    source: options.source ?? normalSource,
    reads: [] as ReadRow[],
    fetches: [] as number[],
    official: [] as { match: string; at: number }[],
    projections: 0,
    calculations: [] as { at: number; rewrite: boolean }[],
    notes: [] as string[],
    locks: 0,
    calendar: 0,
    writes: 0,
  };
  const snapshot = (): ClockSnapshot => structuredClone({
    auto: options.auto ?? true,
    halftime: options.halftime ?? true,
    weeks: [week],
    reads: state.reads,
  });
  const stored = (id: string) => week.matches.find((match) => match.id === id) as ClockMatch;
  const deps: ClockDeps = {
    snapshot: async () => snapshot(),
    async claim(target, attempt, now) {
      if (state.reads.some((row) => row.key === target.key && row.attempt === attempt)) return false;
      state.writes += 1;
      state.reads.push({ key: target.key, attempt, weekId: target.weekId, kind: target.kind, outcome: attempt === 0 ? "alert" : "pending", startedAt: new Date(now).toISOString(), finishedAt: null });
      return true;
    },
    async finish(key, attempt, outcome) {
      const row = state.reads.find((item) => item.key === key && item.attempt === attempt);
      if (row) Object.assign(row, { outcome, finishedAt: new Date(state.now).toISOString() });
    },
    async fetchPage(target) {
      state.fetches.push(state.now);
      if (options.failFetch) throw new Error("Fonte voti non raggiungibile.");
      return fakePage(target, state.source, state.now);
    },
    async lockWeek() { state.locks += 1; week.status = "locked"; },
    async writeProjection() { state.projections += 1; },
    async writeOfficial(_week, match) {
      state.official.push({ match: match.id, at: state.now });
      stored(match.id).status = "finished";
      return 22;
    },
    async releaseHold(match) { Object.assign(stored(match.id), { postponed: false, holdStatus: "none", holdKickoffAt: null }); },
    async refreshProvisional() {},
    async calculate(_week, rewrite) {
      if (options.failCalc) return { scored: false, reason: "Calcolo di prova fallito." };
      state.calculations.push({ at: state.now, rewrite });
      week.status = "scored";
      return { scored: true };
    },
    async refreshCalendar() { state.calendar += 1; return { changed: 0, warnings: [] }; },
    async notify(message) { state.notes.push(message); },
  };
  async function call(now: number): Promise<CycleReport | null> {
    state.now = now;
    const seen = snapshot();
    const plan = planVoteClock(seen, now);
    if (planIsEmpty(plan)) return null;
    return runVoteCycle(deps, seen, plan, now);
  }
  /** Suona la sveglia per i giorni indicati; `skip` simula le chiamate perse. */
  async function ring(days: string[], skip: (time: number) => boolean = () => false) {
    for (const day of days) {
      const times = [romeTime(day, 8), romeTime(day, 8, 30)];
      for (let hour = 13; hour <= 23; hour += 1) for (const minute of MATCH_MINUTES) times.push(romeTime(day, hour, minute));
      for (const time of times) if (!skip(time)) await call(time + 2000);
    }
  }
  const votes = (kind: string) => state.reads.filter((row) => row.kind === kind && row.attempt > 0);
  return { state, deps, call, ring, votes, week };
}

const clock = (time: number) => {
  const parts = romeParts(time);
  return `${parts.date.slice(8)}/${parts.date.slice(5, 7)} ${String(Math.floor(parts.minutes / 60)).padStart(2, "0")}:${String(parts.minutes % 60).padStart(2, "0")}`;
};
const between = (time: number, date: string, from: string, to: string) => time >= at(date, from) && time <= at(date, to);

export async function runVoteScheduleChecks() {
  const cases: Case[] = [];
  const add = (name: string, pass: boolean, detail: string) => cases.push({ name, pass, detail });

  const parsed = fakePage(weekOf(ROUND), normalSource, at("2026-12-01", "08:00"));
  add("La pagina dice quali partite sono finite", parsed.scores.length === 10 && parsed.scores.every((score) => score.status === 4), `${parsed.scores.length} partite`);
  add("08:00 di Roma con ora solare e legale",
    new Date(romeTime("2026-12-01", 8)).toISOString() === "2026-12-01T07:00:00.000Z"
      && new Date(romeTime("2027-04-05", 8)).toISOString() === "2027-04-05T06:00:00.000Z",
    new Date(romeTime("2027-04-05", 8)).toISOString());

  const normal = harness(weekOf(ROUND));
  await normal.ring(DAYS);
  add("Turno normale: 9 orari, 19 richieste alla fonte", normal.state.fetches.length === 19, `${normal.state.fetches.length}: ${normal.state.fetches.map(clock).join(", ")}`);
  add("Letture al minuto 50 e al minuto 120",
    normal.state.fetches.includes(at("2026-11-29", "13:20") + 2000) && normal.state.fetches.includes(at("2026-11-29", "14:30") + 2000),
    normal.state.fetches.slice(8, 12).map(clock).join(", "));
  add("Due partite in contemporanea, una sola lettura", normal.votes("halftime").length === 9 && normal.votes("fulltime").length === 9, `${normal.votes("halftime").length} e ${normal.votes("fulltime").length}`);
  add("Voti ufficiali solo la mattina dopo l'ultima partita",
    normal.state.official.length === 10 && normal.state.official.every((row) => row.at === at("2026-12-01", "08:00") + 2000),
    `${normal.state.official.length} partite`);
  add("Un solo calcolo, dopo la lettura delle 08:00",
    normal.state.calculations.length === 1 && normal.state.calculations[0].at === at("2026-12-01", "08:00") + 2000,
    normal.state.calculations.map((row) => clock(row.at)).join(", "));
  add("Turno normale senza avvisi", normal.state.notes.length === 0, normal.state.notes.join(" | "));
  add("Calendario una volta al giorno", normal.state.calendar === DAYS.length, `${normal.state.calendar}`);
  add("Formazioni chiuse alla prima lettura", normal.state.locks === 1, `${normal.state.locks}`);

  const silent = harness(weekOf(ROUND), { source: silentSource });
  await silent.ring([...DAYS, "2026-12-02"]);
  add("Voti mai pronti: 38 richieste, due per lettura", silent.state.fetches.length === 38, `${silent.state.fetches.length}`);
  add("Un avviso per ogni lettura fallita, poi stop", silent.state.notes.length === 19, `${silent.state.notes.length}`);
  add("Senza voti non si calcola e nessuna partita risulta finita",
    silent.state.calculations.length === 0 && silent.state.official.length === 0, `${silent.state.official.length}`);

  const residue = await silent.call(at("2026-12-02", "16:00"));
  add("Dopo gli avvisi non resta lavoro in coda", residue === null, residue ? residue.reads.join(", ") : "vuoto");

  const tenSlots: [string, string][] = ["12:30", "15:00", "18:00", "20:45"].map((time) => ["2026-11-28", time] as [string, string])
    .concat(["12:30", "15:00", "18:00", "20:45"].map((time) => ["2026-11-29", time] as [string, string]), [["2026-11-27", "20:45"], ["2026-11-30", "20:45"]]);
  const worst = harness(weekOf(tenSlots), { source: silentSource });
  await worst.ring([...DAYS, "2026-12-02"]);
  add("Massimo con 10 orari diversi: 42 richieste", worst.state.fetches.length === 42, `${worst.state.fetches.length}`);

  const down = harness(weekOf(ROUND), { failFetch: true });
  await down.ring(["2026-11-27"]);
  add("Fonte irraggiungibile: due tentativi per lettura e un avviso", down.state.fetches.length === 4 && down.state.notes.length === 2, `${down.state.fetches.length} richieste, ${down.state.notes.length} avvisi`);

  const noHalf = harness(weekOf(ROUND), { halftime: false });
  await noHalf.ring(DAYS);
  add("Intervallo spento: 10 richieste", noHalf.state.fetches.length === 10 && noHalf.votes("halftime").length === 0, `${noHalf.state.fetches.length}`);

  const off = harness(weekOf(ROUND), { auto: false });
  await off.ring(DAYS);
  add("Automatico spento: nessuna richiesta e nessuna scrittura", off.state.fetches.length === 0 && off.state.writes === 0, `${off.state.writes}`);

  const idle = harness(weekOf(ROUND));
  await idle.call(at("2026-11-26", "08:00"));
  const writes = idle.state.writes;
  const quiet = await idle.call(at("2026-11-26", "16:00"));
  add("Fuori dai momenti previsti: niente richieste né scritture",
    quiet === null && idle.state.writes === writes && idle.state.fetches.length === 0, `${idle.state.writes - writes}`);

  const extra = harness(weekOf(ROUND), { source: silentSource });
  for (let time = at("2026-11-27", "00:00"); time < at("2026-12-03", "00:00"); time += 3 * MINUTE) await extra.call(time);
  add("Chiamate in più (GitHub) non superano il massimo", extra.state.fetches.length <= 38, `${extra.state.fetches.length}`);

  const twice = harness(weekOf(ROUND));
  twice.state.now = at("2026-11-28", "15:50");
  const seen = await twice.deps.snapshot();
  seen.reads.push({ key: "cal:2026-11-28", attempt: 1, weekId: null, kind: "calendar", outcome: "ok", startedAt: new Date(twice.state.now).toISOString(), finishedAt: null });
  const plan = planVoteClock(seen, twice.state.now);
  await Promise.all([
    runVoteCycle(twice.deps, structuredClone(seen), structuredClone(plan), twice.state.now),
    runVoteCycle(twice.deps, structuredClone(seen), structuredClone(plan), twice.state.now),
  ]);
  add("Due sveglie insieme: una sola richiesta", twice.state.fetches.length === 1, `${twice.state.fetches.length}`);

  const lostHalf = harness(weekOf(ROUND));
  await lostHalf.ring(DAYS, (time) => between(time, "2026-11-28", "15:45", "16:30"));
  add("Intervallo perso: si salta, la fine partita resta",
    lostHalf.votes("halftime").length === 8 && lostHalf.votes("fulltime").length === 9 && lostHalf.state.notes.length === 0,
    `${lostHalf.votes("halftime").length} intervalli`);

  const lostEvening = harness(weekOf(ROUND));
  await lostEvening.ring(DAYS, (time) => between(time, "2026-11-28", "22:00", "23:59"));
  add("Fine partita persa: si recupera la mattina", lostEvening.votes("fulltime").length === 9 && lostEvening.state.calculations.length === 1, `${lostEvening.votes("fulltime").length}`);

  const lostMorning = harness(weekOf(ROUND));
  await lostMorning.ring(DAYS, (time) => between(time, "2026-12-01", "07:00", "09:00"));
  add("Mattina persa: si recupera alle 13:00 e poi si calcola",
    lostMorning.state.calculations.length === 1 && lostMorning.state.calculations[0].at === at("2026-12-01", "13:00") + 2000,
    lostMorning.state.calculations.map((row) => clock(row.at)).join(", "));

  const partial = (until: number): Source => (match, now) => (
    match.id === "m9" && now < until ? { grades: [15, 10], status: 4, score: true } : normalSource(match, now)
  );
  const late = harness(weekOf(ROUND), { source: partial(at("2026-12-01", "08:20")) });
  await late.ring(DAYS);
  add("Voti completi al secondo tentativo: calcolo alle 08:30",
    late.state.calculations.length === 1 && late.state.calculations[0].at === at("2026-12-01", "08:30") + 2000,
    late.state.calculations.map((row) => clock(row.at)).join(", "));

  const incomplete = harness(weekOf(ROUND), { source: partial(at("2027-01-01", "00:00")) });
  await incomplete.ring([...DAYS, "2026-12-02", "2026-12-03"]);
  add("Dieci voti in una squadra: niente calcolo e partita non finita",
    incomplete.state.calculations.length === 0 && !incomplete.state.official.some((row) => row.match === "m9")
      && incomplete.votes("morning").length === 2 && incomplete.state.notes.some((note) => note.includes("non viene calcolata")),
    incomplete.state.notes.join(" | "));

  const unmarked: Source = (match, now) => ({ ...normalSource(match, now), status: null });
  const noStatus = harness(weekOf(ROUND), { source: unmarked });
  await noStatus.ring(DAYS);
  add("Se la pagina non dice «finita» non si calcola", noStatus.state.calculations.length === 0 && noStatus.state.official.length === 0, `${noStatus.state.official.length}`);

  const early = harness(weekOf(ROUND, 11));
  await early.ring(DAYS);
  add("Prima della giornata 12: voti ufficiali ma nessun calcolo", early.state.official.length === 10 && early.state.calculations.length === 0, `${early.state.calculations.length}`);

  const broken = harness(weekOf(ROUND), { failCalc: true });
  await broken.ring([...DAYS, "2026-12-02"]);
  add("Calcolo fallito: un avviso e nessun ritentativo continuo",
    broken.state.notes.filter((note) => note.includes("calcolo non riuscito")).length === 1 && broken.state.reads.filter((row) => row.kind === "calc").length === 1,
    broken.state.notes.join(" | "));

  const postponedWeek = weekOf(ROUND);
  Object.assign(postponedWeek.matches[9], { postponed: true, holdStatus: "postponed", holdKickoffAt: postponedWeek.matches[9].kickoffAt });
  const postponed = harness(postponedWeek);
  await postponed.ring(DAYS);
  add("Rinvio senza nuovo orario: nessuna lettura e calcolo in attesa",
    postponed.votes("halftime").length === 8 && postponed.state.calculations.length === 0
      && postponed.state.official.length === 9 && postponed.state.notes.filter((note) => note.includes("dopo il recupero")).length === 1,
    postponed.state.notes.join(" | "));
  const before = postponed.state.fetches.length;
  postponedWeek.matches[9].kickoffAt = new Date(at("2026-12-09", "18:30")).toISOString();
  await postponed.ring(["2026-12-09", "2026-12-10"]);
  add("Recupero con nuovo orario: tre letture, poi calcolo",
    postponed.state.fetches.length - before === 3 && postponed.state.calculations.length === 1 && !postponedWeek.matches[9].postponed,
    `${postponed.state.fetches.length - before} richieste, ${postponed.state.calculations.length} calcoli`);

  const scoredWeek = weekOf(ROUND);
  scoredWeek.status = "scored";
  for (const match of scoredWeek.matches.slice(0, 9)) match.status = "finished";
  Object.assign(scoredWeek.matches[9], { postponed: true, holdStatus: "postponed", holdKickoffAt: scoredWeek.matches[9].kickoffAt, kickoffAt: new Date(at("2026-12-09", "18:30")).toISOString() });
  const recovery = harness(scoredWeek);
  await recovery.ring(["2026-12-09", "2026-12-10"]);
  add("Recupero di una giornata già calcolata: un solo ricalcolo",
    recovery.state.fetches.length === 3 && recovery.state.calculations.length === 1 && recovery.state.calculations[0].rewrite,
    `${recovery.state.fetches.length} richieste, ${recovery.state.calculations.length} calcoli`);

  const moved = harness(weekOf(ROUND));
  moved.deps.refreshCalendar = async () => {
    moved.week.matches[0].kickoffAt = new Date(at("2026-11-27", "18:00")).toISOString();
    return { changed: 1, warnings: ["G12 orario variato"] };
  };
  await moved.call(at("2026-11-27", "08:00"));
  add("Orario cambiato dal calendario: avviso, nessun voto richiesto prima del tempo", moved.state.fetches.length === 0 && moved.state.notes.length === 1, `${moved.state.fetches.length}`);
  const calendarDown = harness(weekOf(ROUND));
  calendarDown.deps.refreshCalendar = async () => { throw new Error("Sky ha risposto 503."); };
  await calendarDown.ring(["2026-11-26"]);
  add("Calendario irraggiungibile: due tentativi e un avviso",
    calendarDown.votes("calendar").length === 2 && calendarDown.state.notes.length === 1, calendarDown.state.notes.join(" | "));

  const early12 = weekOf(ROUND);
  early12.matches[0].kickoffAt = new Date(at("2026-11-25", "20:45")).toISOString();
  const advanced = harness(early12);
  await advanced.ring(["2026-11-25", "2026-11-26", ...DAYS]);
  add("Anticipo: si legge al nuovo orario, la mattina resta una", advanced.votes("morning").length === 1 && advanced.state.calculations.length === 1, `${advanced.votes("morning").length}`);

  const manual = harness(weekOf(ROUND));
  manual.state.now = at("2026-11-30", "23:30");
  await runManualRead(manual.deps, manual.state.now);
  add("Forza sync prima delle 08:00: solo provvisorio", manual.state.official.length === 0 && manual.state.calculations.length === 0 && manual.state.projections === 1, `${manual.state.official.length}`);
  manual.state.now = at("2026-12-01", "09:00");
  await runManualRead(manual.deps, manual.state.now);
  add("Forza sync dopo le 08:00: ufficiale e calcolo, senza consumare tentativi",
    manual.state.official.length === 10 && manual.state.calculations.length === 1 && manual.state.reads.length === 0,
    `${manual.state.official.length}`);
  const refused = harness(weekOf(ROUND), { source: partial(at("2027-01-01", "00:00")) });
  refused.state.now = at("2026-12-01", "09:00");
  await runManualRead(refused.deps, refused.state.now);
  add("Forza sync con voti incompleti non calcola", refused.state.calculations.length === 0, `${refused.state.calculations.length}`);

  const failures = cases.filter((item) => !item.pass).map((item) => `${item.name}: ${item.detail}`);
  return { passed: cases.length - failures.length, total: cases.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runVoteScheduleChecks().then((result) => {
    console.log(`Letture dei voti: ${result.passed}/${result.total}`);
    for (const failure of result.failures) console.log(`- ${failure}`);
    if (result.failures.length > 0) process.exit(1);
  });
}
