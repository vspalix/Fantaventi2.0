// La Dashboard dell'area admin: cosa va controllato e i numeri sulle persone.
// Solo calcoli: nessun database e nessuna rete, così si prova con dati inventati.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Il calendario si legge ogni mattina: oltre questo silenzio le sveglie sono ferme. */
export const READS_SILENT_AFTER = 28 * HOUR;
/** Gli indisponibili si aggiornano due volte al giorno. */
export const AVAILABILITY_STALE_AFTER = 36 * HOUR;
/** Account di prova creati dagli strumenti di collaudo: non sono persone. */
export const TEST_EMAIL_SUFFIX = "@fantaventi.test";
/** Entro quanti giorni dall'ultima formazione salvata una persona sta giocando. */
export const PLAYING_DAYS = 14;
export const SIGNUP_WEEKS = 8;

export type DashboardProblem = { id: string; tone: "bad" | "warn"; title: string; detail: string; href: string };

export type DashboardRead = { key: string; kind: string; outcome: string; startedAt: string; weekId: string | null };

export type DashboardMatch = { status: string; kickoffAt: string; held: boolean };

/** Quanto dura una partita, intervallo compreso. */
const MATCH_LENGTH = 2 * HOUR;

/**
 * Le partite si segnano «finite» solo con la lettura ufficiale del mattino dopo il turno:
 * quante sono giocate o in corso si capisce dall'orario.
 */
export function matchProgress(matches: DashboardMatch[], now: number) {
  let played = 0;
  let live = 0;
  for (const match of matches) {
    const elapsed = now - new Date(match.kickoffAt).getTime();
    if (match.status === "finished" || (!match.held && elapsed >= MATCH_LENGTH)) played += 1;
    else if (!match.held && elapsed >= 0) live += 1;
  }
  return { total: matches.length, played, live };
}

export type ProblemInput = {
  now: number;
  /** null = non letto: lo dice già un altro avviso. */
  maintenance: boolean | null;
  autoReads: boolean | null;
  week: { id: string; number: number; status: string; deadlineAt: string } | null;
  matches: DashboardMatch[];
  /** Letture degli ultimi due giorni. */
  reads: DashboardRead[] | null;
  lastReadAt: string | null;
  availability: { manual: boolean; lastSyncAt: string | null; unmatched: number } | null;
  missingLineups: number;
};

const WHEN = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

export function dashboardWhen(value: string) {
  return WHEN.format(new Date(value));
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const READ_FAILURES: Record<string, { title: string; group: "votes" | "calendar" | "calc" }> = {
  halftime: { title: "Lettura dei voti non riuscita", group: "votes" },
  fulltime: { title: "Lettura dei voti non riuscita", group: "votes" },
  morning: { title: "Lettura dei voti non riuscita", group: "votes" },
  calendar: { title: "Lettura del calendario non riuscita", group: "calendar" },
  calc: { title: "Calcolo della giornata non riuscito", group: "calc" },
};

/** Una lettura fallita conta finché una lettura successiva dello stesso tipo non riesce. */
function failedReads(reads: DashboardRead[]) {
  const failed = new Map<string, DashboardRead>();
  for (const read of reads) {
    const kind = READ_FAILURES[read.kind];
    if (!kind || (read.outcome !== "error" && read.outcome !== "alert")) continue;
    const solved = reads.some((other) => (
      other.outcome === "ok"
      && READ_FAILURES[other.kind]?.group === kind.group
      && (kind.group === "calendar" || other.weekId === read.weekId)
      && (other.key === read.key || other.startedAt > read.startedAt)
    ));
    if (solved) continue;
    const current = failed.get(kind.group);
    if (!current || read.startedAt > current.startedAt) failed.set(kind.group, read);
  }
  return [...failed.entries()];
}

export function findProblems(input: ProblemInput): DashboardProblem[] {
  const { now, week, matches } = input;
  const found: DashboardProblem[] = [];
  const add = (id: string, tone: DashboardProblem["tone"], title: string, detail: string, href: string) => (
    found.push({ id, tone, title, detail, href })
  );
  const reads = "/admin/laboratorio/sincronizzazioni";
  const injuries = "/admin/laboratorio/indisponibili";

  if (input.maintenance) add("maintenance", "bad", "Manutenzione accesa", "Chi usa l'app non può salvare niente.", "/admin/laboratorio");

  if (input.autoReads === false) {
    add("auto-off", "warn", "Letture automatiche spente", "Voti e calendario non si aggiornano da soli.", reads);
  } else if (input.autoReads && input.lastReadAt && now - new Date(input.lastReadAt).getTime() > READS_SILENT_AFTER) {
    add("silent", "bad", "Le letture automatiche sembrano ferme", `Ultima lettura: ${dashboardWhen(input.lastReadAt)}.`, reads);
  }

  for (const [group, read] of failedReads(input.reads ?? [])) {
    add(`read-${group}`, "bad", READ_FAILURES[read.kind].title, `Ultimo tentativo: ${dashboardWhen(read.startedAt)}.`, reads);
  }

  if (week) {
    const open = week.status !== "scored" && week.status !== "final";
    const ended = matches.length > 0 && matches.every((match) => match.status === "finished");
    const regular = matches.filter((match) => !match.held);
    // Un giorno dopo l'ultima partita la lettura del mattino deve essere già passata.
    const turnOver = regular.length > 0 && now - Math.max(...regular.map((match) => new Date(match.kickoffAt).getTime())) > DAY;
    if (open && ended && turnOver) {
      add("to-calculate", "bad", `Giornata ${week.number} ancora da calcolare`, "Le partite sono finite da più di un giorno.", "/admin/giornata");
    }
    const stuck = regular.filter((match) => match.status !== "finished").length;
    if (open && turnOver && stuck > 0) {
      add("stuck", "warn", plural(stuck, "partita senza voti ufficiali", "partite senza voti ufficiali"), "Il turno è finito da più di un giorno.", "/admin/giornata");
    }
    const held = matches.filter((match) => match.held).length;
    if (open && held > 0) {
      add("held", "warn", plural(held, "partita rinviata o sospesa", "partite rinviate o sospese"), `Giornata ${week.number}.`, "/admin/giornata");
    }
    const left = new Date(week.deadlineAt).getTime() - now;
    if (input.missingLineups > 0 && left > 0 && left <= DAY) {
      const hours = Math.floor(left / HOUR);
      add(
        "lineups",
        "warn",
        plural(input.missingLineups, "squadra senza formazione", "squadre senza formazione"),
        hours < 1 ? "Si chiude tra meno di un'ora." : `Si chiude tra ${plural(hours, "ora", "ore")}.`,
        "/admin/formazioni",
      );
    }
  }

  const availability = input.availability;
  if (availability) {
    if (!availability.manual && availability.lastSyncAt && now - new Date(availability.lastSyncAt).getTime() > AVAILABILITY_STALE_AFTER) {
      add("injuries-stale", "warn", "Indisponibili non aggiornati", `Ultimo aggiornamento: ${dashboardWhen(availability.lastSyncAt)}.`, injuries);
    }
    if (availability.unmatched > 0) {
      add(
        "injuries-unmatched",
        "warn",
        plural(availability.unmatched, "indisponibile da abbinare", "indisponibili da abbinare"),
        "Il nome non coincide con il listone.",
        injuries,
      );
    }
  }

  // Prima i problemi veri, poi le cose da tenere d'occhio.
  return found.sort((left, right) => Number(left.tone === "warn") - Number(right.tone === "warn"));
}

export type DashboardAccount = { id: string; email: string; createdAt: string };

export type PeopleSummary = {
  users: number;
  testUsers: number;
  newThisWeek: number;
  /** Nuovi iscritti per settimana, dalla più vecchia a quella in corso. */
  weekly: number[];
  /** Hanno salvato una formazione negli ultimi giorni. */
  playing: number;
  withPush: number;
  withoutLeague: number;
};

export function summarizePeople(
  accounts: DashboardAccount[],
  playingIds: Iterable<string>,
  pushIds: Iterable<string>,
  leagueIds: Iterable<string>,
  now: number,
): PeopleSummary {
  const people = accounts.filter((account) => !account.email.toLowerCase().endsWith(TEST_EMAIL_SUFFIX));
  const real = new Set(people.map((account) => account.id));
  const countReal = (ids: Iterable<string>) => [...new Set(ids)].filter((id) => real.has(id)).length;
  const weekly = new Array<number>(SIGNUP_WEEKS).fill(0);
  for (const account of people) {
    const age = Math.floor(Math.max(0, now - new Date(account.createdAt).getTime()) / (7 * DAY));
    if (age < SIGNUP_WEEKS) weekly[SIGNUP_WEEKS - 1 - age] += 1;
  }
  return {
    users: people.length,
    testUsers: accounts.length - people.length,
    newThisWeek: weekly[SIGNUP_WEEKS - 1],
    weekly,
    playing: countReal(playingIds),
    withPush: countReal(pushIds),
    withoutLeague: people.length - countReal(leagueIds),
  };
}
