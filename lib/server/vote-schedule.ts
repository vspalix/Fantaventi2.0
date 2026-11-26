// Quando leggere i voti. Funzioni pure: nessun database, nessuna rete.
// Tre letture per i voti (fine primo tempo, fine partita, 08:00 dopo l'ultima partita del turno),
// più il calendario una volta al giorno. Ogni lettura ha al massimo un nuovo tentativo.

export type ReadKind = "halftime" | "fulltime" | "morning" | "calendar" | "calc";
export type ReadOutcome = "pending" | "ok" | "not_ready" | "error" | "alert";

export type ReadRow = {
  key: string;
  attempt: number;
  weekId: string | null;
  kind: ReadKind;
  outcome: ReadOutcome;
  startedAt: string;
  finishedAt: string | null;
};

export type ClockMatch = {
  id: string;
  kickoffAt: string;
  status: string;
  home: string;
  away: string;
  homeClubId: string;
  awayClubId: string;
  postponed: boolean;
  holdStatus: string;
  holdKickoffAt: string | null;
};

export type ClockWeek = {
  id: string;
  number: number;
  status: string;
  seasonCode: string;
  matches: ClockMatch[];
};

export type ClockSnapshot = {
  auto: boolean;
  halftime: boolean;
  weeks: ClockWeek[];
  reads: ReadRow[];
};

export type ReadTask = {
  key: string;
  kind: "halftime" | "fulltime" | "morning" | "calendar";
  weekId: string | null;
  matchIds: string[];
  /** Primo momento utile e momento del nuovo tentativo, in millisecondi. */
  due: number;
  retryAt: number;
  retryGap: number;
  expires: number;
};

export type DueRead = ReadTask & { attempt: 1 | 2 };

export type VotePlan = {
  reads: DueRead[];
  /** Letture fallite o perse per cui l'avviso non è ancora partito. */
  alerts: ReadTask[];
  /** Giornate complete, già lette la mattina e non ancora calcolate. */
  calculations: string[];
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** La sveglia può arrivare qualche secondo prima del minuto esatto. */
const EARLY = MINUTE;
/** Un tentativo rimasto in sospeso oltre questo tempo si considera fallito. */
const STALE = 10 * MINUTE;
const LOST_ALERT = 7 * 24 * HOUR;

export const AUTO_CALC_FROM_GAMEWEEK = 12;

const rome = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function romeParts(time: number) {
  const bag = Object.fromEntries(rome.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return {
    date: `${bag.year}-${bag.month}-${bag.day}`,
    minutes: (Number(bag.hour) % 24) * 60 + Number(bag.minute),
  };
}

function nextDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** L'istante in cui a Roma sono le ore:minuti di quel giorno, con l'ora legale corretta. */
export function romeTime(date: string, hour: number, minute = 0) {
  const [year, month, day] = date.split("-").map(Number);
  const wanted = hour * 60 + minute;
  for (const offset of [2, 1]) {
    const time = Date.UTC(year, month - 1, day, hour - offset, minute);
    const found = romeParts(time);
    if (found.date === date && found.minutes === wanted) return time;
  }
  return Date.UTC(year, month - 1, day, hour - 1, minute);
}

export function isHeld(match: ClockMatch) {
  return match.postponed || match.holdStatus === "postponed" || match.holdStatus === "suspended";
}

/** Una partita rinviata si legge di nuovo solo quando ha un orario diverso da quello del rinvio. */
export function isRescheduled(match: ClockMatch) {
  return isHeld(match)
    && match.holdKickoffAt !== null
    && new Date(match.holdKickoffAt).getTime() !== new Date(match.kickoffAt).getTime();
}

export function playableMatches(week: ClockWeek) {
  return week.matches.filter((match) => (
    Number.isFinite(new Date(match.kickoffAt).getTime()) && (!isHeld(match) || isRescheduled(match))
  ));
}

function settled(week: ClockWeek) {
  return week.status === "scored" || week.status === "final";
}

export function voteTasks(week: ClockWeek, halftime: boolean): ReadTask[] {
  if (week.status === "final") return [];
  const playable = playableMatches(week);
  const slots = new Map<number, ClockMatch[]>();
  for (const match of playable) {
    if (match.status === "finished") continue;
    const kickoff = new Date(match.kickoffAt).getTime();
    slots.set(kickoff, [...(slots.get(kickoff) ?? []), match]);
  }
  const tasks: ReadTask[] = [];
  // Le partite in contemporanea condividono la stessa lettura.
  for (const [kickoff, matches] of slots) {
    const stamp = new Date(kickoff).toISOString();
    const matchIds = matches.map((match) => match.id);
    if (halftime) {
      tasks.push({
        key: `ht:${week.id}:${stamp}`,
        kind: "halftime",
        weekId: week.id,
        matchIds,
        due: kickoff + 50 * MINUTE,
        retryAt: kickoff + 60 * MINUTE,
        retryGap: 8 * MINUTE,
        // Ricominciata la partita, l'intervallo si salta.
        expires: kickoff + 64 * MINUTE,
      });
    }
    tasks.push({
      key: `ft:${week.id}:${stamp}`,
      kind: "fulltime",
      weekId: week.id,
      matchIds,
      due: kickoff + 120 * MINUTE,
      retryAt: kickoff + 135 * MINUTE,
      retryGap: 12 * MINUTE,
      expires: kickoff + 24 * HOUR,
    });
  }

  const needsMorning = settled(week) ? playable.some((match) => match.status !== "finished") : playable.length > 0;
  if (needsMorning) {
    const last = Math.max(...playable.map((match) => new Date(match.kickoffAt).getTime()));
    const date = nextDate(romeParts(last).date);
    const due = romeTime(date, 8);
    tasks.push({
      key: `am:${week.id}:${date}`,
      kind: "morning",
      weekId: week.id,
      matchIds: playable.map((match) => match.id),
      due,
      retryAt: romeTime(date, 8, 30),
      retryGap: 25 * MINUTE,
      expires: due + 48 * HOUR,
    });
  }
  return tasks;
}

export function calendarTask(now: number): ReadTask {
  const date = romeParts(now).date;
  return {
    key: `cal:${date}`,
    kind: "calendar",
    weekId: null,
    matchIds: [],
    due: romeTime(date, 8),
    retryAt: romeTime(date, 8, 30),
    retryGap: 25 * MINUTE,
    expires: romeTime(date, 23, 59),
  };
}

function history(reads: ReadRow[], key: string) {
  const rows = reads.filter((row) => row.key === key);
  const attempts = rows.filter((row) => row.attempt > 0).sort((left, right) => left.attempt - right.attempt);
  return {
    attempts,
    done: attempts.some((row) => row.outcome === "ok"),
    alerted: rows.some((row) => row.attempt === 0),
  };
}

function secondAttemptAt(task: ReadTask, first: ReadRow) {
  return Math.max(task.retryAt, new Date(first.startedAt).getTime() + task.retryGap);
}

export function dueAttempt(task: ReadTask, reads: ReadRow[], now: number): 1 | 2 | null {
  const { attempts, done } = history(reads, task.key);
  if (done || attempts.length >= 2 || now > task.expires) return null;
  if (attempts.length === 0) return now >= task.due - EARLY ? 1 : null;
  return now >= secondAttemptAt(task, attempts[0]) - EARLY ? 2 : null;
}

export function needsAlert(task: ReadTask, reads: ReadRow[], now: number) {
  const { attempts, done, alerted } = history(reads, task.key);
  if (done || alerted) return false;
  if (attempts.length === 0) {
    // Persa del tutto: si avvisa solo per la lettura che decide il calcolo.
    return task.kind === "morning" && now > task.expires && now < task.expires + LOST_ALERT;
  }
  const last = attempts[attempts.length - 1];
  const finished = last.outcome !== "pending" || now - new Date(last.startedAt).getTime() > STALE;
  if (!finished) return false;
  if (attempts.length >= 2) return true;
  return now > task.expires || secondAttemptAt(task, attempts[0]) - EARLY > task.expires;
}

export function readyToCalculate(week: ClockWeek, reads: ReadRow[]) {
  return !settled(week)
    && week.number >= AUTO_CALC_FROM_GAMEWEEK
    && week.matches.length > 0
    && week.matches.every((match) => match.status === "finished")
    // Un calcolo già fallito e segnalato non si ritenta da solo.
    && !reads.some((row) => row.key === `calc:${week.id}`)
    && reads.some((row) => row.weekId === week.id && row.kind === "morning" && row.outcome === "ok");
}

export function planVoteClock(snapshot: ClockSnapshot, now: number): VotePlan {
  const plan: VotePlan = { reads: [], alerts: [], calculations: [] };
  if (!snapshot.auto) return plan;
  const tasks = [calendarTask(now), ...snapshot.weeks.flatMap((week) => voteTasks(week, snapshot.halftime))];
  for (const task of tasks) {
    const attempt = dueAttempt(task, snapshot.reads, now);
    if (attempt) plan.reads.push({ ...task, attempt });
    else if (needsAlert(task, snapshot.reads, now)) plan.alerts.push(task);
  }
  plan.calculations = snapshot.weeks.filter((week) => readyToCalculate(week, snapshot.reads)).map((week) => week.id);
  return plan;
}

export function planIsEmpty(plan: VotePlan) {
  return plan.reads.length === 0 && plan.alerts.length === 0 && plan.calculations.length === 0;
}
