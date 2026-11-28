// Ingresso in corsa: chi arriva dopo la prima giornata della lega riceve, per ogni giornata
// saltata, la media delle squadre che in quella giornata erano già in gioco. La sua non conta.
// Funzioni pure: le usano classifica di lega, finestre di mercato, home e centro partite.

export type EntryContext = {
  teamIds: readonly string[];
  /** Prima giornata con una formazione, per squadra. Chi non ha mai schierato non c'è. */
  entryByTeam: ReadonlyMap<string, number>;
  startMatchday: number;
  /** false nelle leghe a numero chiuso. */
  allowed: boolean;
  /** Squadre già dentro quando le iscrizioni sono state chiuse: conservano la media. */
  kept?: ReadonlySet<string>;
  /**
   * Chi è iscritto ma non ha ancora schierato: la giornata da cui può giocare. Vale per dargli
   * subito la media; non lo fa contare nella media degli altri.
   */
  waiting?: ReadonlyMap<string, number>;
};

type Week = { id: string; number: number };

/** Chi ha diritto alla media di ingresso, secondo le regole della lega. Da usare in ogni calcolo. */
export function entryPolicy(rules: { enrollment: "open" | "closed"; lateEntryKept: readonly string[] }) {
  return { allowed: rules.enrollment !== "closed", kept: new Set(rules.lateEntryKept) };
}

/** La giornata di ingresso di chi è arrivato in corsa, altrimenti null. */
export function lateEntryOf(context: EntryContext, teamId: string) {
  const entry = context.entryByTeam.get(teamId) ?? context.waiting?.get(teamId);
  const entitled = context.allowed || Boolean(context.kept?.has(teamId));
  return entitled && entry !== undefined && entry > context.startMatchday ? entry : null;
}

/**
 * La giornata da cui gioca chi non ha ancora schierato: quella da cui parte la sua rosa oppure,
 * se non ha una rosa, la prima ancora da chiudere. null se coincide con l'inizio della lega.
 */
export function waitingWeek(rosterFrom: number | null, nextOpen: number, startMatchday: number) {
  const week = Math.max(rosterFrom ?? nextOpen, startMatchday);
  return week > startMatchday ? week : null;
}

/** La media di una giornata fra chi era già in gioco; null se non c'era nessuno. */
export function presentAverage(context: EntryContext, matchday: number, pointsOf: (teamId: string) => number) {
  const present = context.teamIds.filter((teamId) => {
    const entry = context.entryByTeam.get(teamId);
    return entry !== undefined && entry <= matchday;
  });
  if (present.length === 0) return null;
  return present.reduce((sum, teamId) => sum + pointsOf(teamId), 0) / present.length;
}

/** I punti di ingresso: la somma delle medie delle giornate saltate. */
export function entryCredit(
  context: EntryContext,
  teamId: string,
  weeks: readonly Week[],
  pointsOf: (teamId: string, gameweekId: string) => number,
) {
  const entry = lateEntryOf(context, teamId);
  const missed = entry === null ? [] : weeks.filter((week) => week.number < entry);
  const points = missed.reduce((sum, week) => (
    sum + (presentAverage(context, week.number, (other) => pointsOf(other, week.id)) ?? 0)
  ), 0);
  return { entry, skipped: missed.length, points, average: missed.length === 0 ? null : points / missed.length };
}

/**
 * Cosa aggiunge una giornata alla classifica di una squadra: i suoi punti, oppure la media
 * se non era ancora entrata. `fielded` contiene le coppie `squadra:giornata` schierate.
 */
export function weekGain(
  context: EntryContext,
  fielded: ReadonlySet<string>,
  teamId: string,
  week: Week,
  pointsOf: (teamId: string) => number,
) {
  const entry = lateEntryOf(context, teamId);
  if (entry === null) return pointsOf(teamId);
  if (week.number < entry) return presentAverage(context, week.number, pointsOf) ?? 0;
  return fielded.has(`${teamId}:${week.id}`) ? pointsOf(teamId) : 0;
}
