// Esegue le letture decise da vote-schedule. Tutto ciò che tocca database, rete e avvisi
// arriva da fuori (ClockDeps), così le prove usano orari e pagine finte.
import { votesForClubs, type FantacalcioFixtureScore, type FantacalcioPlayerVote } from "@/lib/server/fantacalcio-live";
import {
  AUTO_CALC_FROM_GAMEWEEK,
  isHeld,
  needsAlert,
  planVoteClock,
  playableMatches,
  readyToCalculate,
  voteTasks,
  type ClockMatch,
  type ClockSnapshot,
  type ClockWeek,
  type DueRead,
  type ReadKind,
  type ReadOutcome,
  type ReadRow,
  type ReadTask,
  type VotePlan,
} from "@/lib/server/vote-schedule";
import type { VoteReport, VoteReportMatch } from "@/lib/server/vote-report";

/** Voti minimi per squadra perché una partita conti come completa. */
export const MIN_TEAM_GRADES = 11;
/** Stato con cui la pagina dei voti segna una partita finita. */
export const SOURCE_FINISHED = 4;

export type MatchVoteSyncResult = {
  synced: { gameweekNumber: number; matchId: string; players: number }[];
  waiting: { gameweekNumber: number; matchId: string; reason: string }[];
  projected: number[];
  audited: number[];
  scored: number[];
  skipped: { gameweekNumber: number; reason: string }[];
  errors: { gameweekNumber: number | null; matchId: string | null; message: string }[];
  changed: number;
  samples: string[];
};

export type VotePage = { votes: FantacalcioPlayerVote[]; scores: FantacalcioFixtureScore[] };

export type ChangeSink = { changed: number; samples: string[] };

export type ClaimTarget = { key: string; weekId: string | null; kind: ReadKind };

export type ClockDeps = {
  snapshot(): Promise<ClockSnapshot>;
  /** false se quel tentativo è già stato preso da un'altra chiamata. */
  claim(target: ClaimTarget, attempt: number, now: number): Promise<boolean>;
  finish(key: string, attempt: number, outcome: ReadOutcome, detail: string): Promise<void>;
  fetchPage(week: ClockWeek): Promise<VotePage>;
  lockWeek(week: ClockWeek): Promise<void>;
  writeProjection(week: ClockWeek, votes: FantacalcioPlayerVote[]): Promise<void>;
  /** Scrive i voti ufficiali di una partita completa e la segna finita. Restituisce le righe riconosciute. */
  writeOfficial(week: ClockWeek, match: ClockMatch, page: VotePage, sink: ChangeSink): Promise<number>;
  releaseHold(match: ClockMatch): Promise<void>;
  refreshProvisional(week: ClockWeek): Promise<void>;
  calculate(week: ClockWeek, rewrite: boolean): Promise<{ scored: boolean; reason?: string }>;
  refreshCalendar(): Promise<{ changed: number; warnings: string[] }>;
  notify(text: string): Promise<void>;
  /** Cosa ha inserito una lettura: si manda solo con la modalità test accesa. Non lancia errori. */
  reportVotes(report: VoteReport): Promise<void>;
  /** Giornata calcolata: si manda sempre. Non lancia errori. */
  reportScored(gameweek: number, rewrite: boolean): Promise<void>;
};

export type CycleReport = MatchVoteSyncResult & { reads: string[]; calendarChanged: number };

const LABEL: Record<ReadTask["kind"], string> = {
  halftime: "fine primo tempo",
  fulltime: "fine partita",
  morning: "mattina dopo il turno",
  calendar: "calendario",
};

export function emptyReport(): CycleReport {
  return { synced: [], waiting: [], projected: [], audited: [], scored: [], skipped: [], errors: [], changed: 0, samples: [], reads: [], calendarChanged: 0 };
}

function text(error: unknown) {
  return error instanceof Error ? error.message : "Operazione non riuscita.";
}

function labelOf(match: ClockMatch) {
  return `${match.home}-${match.away}`;
}

function grades(page: VotePage, match: ClockMatch) {
  const votes = votesForClubs(page.votes, match.home, match.away);
  return {
    home: votes.filter((vote) => vote.teamSlug === match.home).length,
    away: votes.filter((vote) => vote.teamSlug === match.away).length,
  };
}

/** Cosa manca perché la partita sia completa, oppure null. */
export function matchProblem(page: VotePage, match: ClockMatch) {
  const score = page.scores.find((item) => item.homeSlug === match.home && item.awaySlug === match.away);
  if (!score || score.status !== SOURCE_FINISHED) return "la fonte non la segna finita";
  if (score.homeGoals === null || score.awayGoals === null) return "manca il risultato";
  const count = grades(page, match);
  if (count.home < MIN_TEAM_GRADES || count.away < MIN_TEAM_GRADES) return `voti incompleti (${count.home} e ${count.away})`;
  return null;
}

function provisionalProblem(page: VotePage, task: ReadTask, week: ClockWeek) {
  const missing = week.matches.filter((match) => task.matchIds.includes(match.id)).flatMap((match) => {
    if (task.kind === "fulltime") {
      const problem = matchProblem(page, match);
      return problem ? [`${labelOf(match)}: ${problem}`] : [];
    }
    const count = grades(page, match);
    return count.home > 0 && count.away > 0 ? [] : [`${labelOf(match)}: voti non pubblicati`];
  });
  return missing.length > 0 ? missing.join("; ") : null;
}

async function writeCompleteMatches(deps: ClockDeps, week: ClockWeek, page: VotePage, now: number, report: CycleReport) {
  const missing: string[] = [];
  const started = playableMatches(week).filter((match) => new Date(match.kickoffAt).getTime() <= now);
  for (const match of started) {
    const problem = matchProblem(page, match);
    let written = 0;
    if (!problem) written = await deps.writeOfficial(week, match, page, report);
    if (problem || written === 0) {
      const reason = problem ?? "i calciatori non sono nel listone";
      missing.push(`${labelOf(match)}: ${reason}`);
      report.waiting.push({ gameweekNumber: week.number, matchId: match.id, reason });
      continue;
    }
    match.status = "finished";
    if (isHeld(match)) {
      await deps.releaseHold(match);
      match.postponed = false;
      match.holdStatus = "none";
      match.holdKickoffAt = null;
    }
    report.synced.push({ gameweekNumber: week.number, matchId: match.id, players: written });
  }
  report.audited.push(week.number);
  await deps.refreshProvisional(week);
  return missing;
}

function reportMatches(page: VotePage, matches: ClockMatch[], official: (match: ClockMatch) => boolean): VoteReportMatch[] {
  return matches.map((match) => ({
    home: match.home,
    away: match.away,
    official: official(match),
    votes: votesForClubs(page.votes, match.home, match.away),
  }));
}

/** Dopo una lettura ufficiale: le partite scritte e, se salvate, quelle ancora provvisorie. */
async function reportOfficial(deps: ClockDeps, week: ClockWeek, page: VotePage, report: CycleReport, label: string, projected: boolean) {
  const written = new Set(report.synced.filter((item) => item.gameweekNumber === week.number).map((item) => item.matchId));
  const read = playableMatches(week).filter((match) => projected || written.has(match.id));
  await deps.reportVotes({ gameweek: week.number, label, matches: reportMatches(page, read, (match) => written.has(match.id)) });
}

async function calculateWeek(deps: ClockDeps, week: ClockWeek, rewrite: boolean, report: CycleReport) {
  try {
    const outcome = await deps.calculate(week, rewrite);
    if (outcome.scored) {
      week.status = "scored";
      report.scored.push(week.number);
      await deps.reportScored(week.number, rewrite);
      return null;
    }
    const reason = outcome.reason ?? "Calcolo non eseguito.";
    report.skipped.push({ gameweekNumber: week.number, reason });
    return reason;
  } catch (error) {
    const reason = text(error);
    report.errors.push({ gameweekNumber: week.number, matchId: null, message: reason });
    return reason;
  }
}

/** Dopo la scrittura dei voti ufficiali: ricalcolo di una giornata già calcolata (recuperi). */
async function rescoreRecovery(deps: ClockDeps, week: ClockWeek, report: CycleReport) {
  if (week.status !== "scored" || !week.matches.every((match) => match.status === "finished")) return;
  const reason = await calculateWeek(deps, week, true, report);
  if (reason) await deps.notify(`Giornata ${week.number}: ricalcolo non riuscito. ${reason}`);
}

function startedUnlocked(week: ClockWeek, now: number) {
  return (week.status === "scheduled" || week.status === "open")
    && playableMatches(week).some((match) => new Date(match.kickoffAt).getTime() <= now);
}

/** Il giro automatico: esegue il piano deciso con la lettura iniziale. */
export async function runVoteCycle(deps: ClockDeps, initial: ClockSnapshot, firstPlan: VotePlan, now: number): Promise<CycleReport> {
  const report = emptyReport();
  let snapshot = initial;
  let plan = firstPlan;
  const reads: ReadRow[] = [...snapshot.reads];
  const attempted: ReadTask[] = [];

  async function claim(target: ClaimTarget, attempt: number) {
    if (!await deps.claim(target, attempt, now)) return false;
    reads.push({ ...target, attempt, outcome: attempt === 0 ? "alert" : "pending", startedAt: new Date(now).toISOString(), finishedAt: null });
    return true;
  }

  async function finish(task: DueRead, outcome: ReadOutcome, detail: string) {
    const row = reads.find((item) => item.key === task.key && item.attempt === task.attempt);
    if (row) Object.assign(row, { outcome, finishedAt: new Date(now).toISOString() });
    await deps.finish(task.key, task.attempt, outcome, detail.slice(0, 500));
  }

  async function alertOnce(target: ClaimTarget, message: string) {
    if (await claim(target, 0)) await deps.notify(message);
  }

  // 1. Calendario, prima dei voti: se un orario cambia, il piano si ricalcola.
  const calendar = plan.reads.find((task) => task.kind === "calendar");
  if (calendar && await claim(calendar, calendar.attempt)) {
    attempted.push(calendar);
    report.reads.push(LABEL.calendar);
    try {
      const outcome = await deps.refreshCalendar();
      await finish(calendar, "ok", `Orari variati: ${outcome.changed}.`);
      report.calendarChanged = outcome.changed;
      if (outcome.warnings.length > 0) await deps.notify(`Calendario da controllare:\n${outcome.warnings.slice(0, 10).join("\n")}`);
      if (outcome.changed > 0) {
        snapshot = await deps.snapshot();
        plan = planVoteClock(snapshot, now);
      }
    } catch (error) {
      await finish(calendar, "error", text(error));
      report.errors.push({ gameweekNumber: null, matchId: null, message: `Calendario: ${text(error)}` });
    }
  }

  // 2. Una sola richiesta alla fonte per giornata, per tutte le letture dovute adesso.
  for (const week of snapshot.weeks) {
    const claimed: DueRead[] = [];
    for (const task of plan.reads) {
      if (task.weekId === week.id && await claim(task, task.attempt)) claimed.push(task);
    }
    if (claimed.length === 0) continue;
    attempted.push(...claimed);
    report.reads.push(...claimed.map((task) => `${LABEL[task.kind]} G${week.number}`));
    const done = new Set<string>();
    try {
      if (startedUnlocked(week, now)) {
        await deps.lockWeek(week);
        week.status = "locked";
      }
      const page = await deps.fetchPage(week);
      const morning = claimed.find((task) => task.kind === "morning");
      // I controlli sulle letture provvisorie vengono prima: quelle ufficiali cambiano lo stato delle partite.
      const provisional = claimed.filter((task) => task.kind !== "morning")
        .map((task) => ({ task, problem: provisionalProblem(page, task, week) }));
      if (morning) {
        const missing = await writeCompleteMatches(deps, week, page, now, report);
        // Le partite ancora incomplete restano visibili con i voti provvisori di questa lettura.
        const projected = missing.length > 0 && page.votes.length > 0 && week.status !== "scored";
        if (projected) await deps.writeProjection(week, page.votes);
        await reportOfficial(deps, week, page, report, LABEL.morning, projected);
        await finish(morning, missing.length > 0 ? "not_ready" : "ok", missing.join("; "));
        done.add(morning.key);
        if (missing.length === 0) {
          await rescoreRecovery(deps, week, report);
          const held = week.matches.filter((match) => match.status !== "finished");
          if (week.status !== "scored" && week.number >= AUTO_CALC_FROM_GAMEWEEK && held.length > 0) {
            await alertOnce(
              { key: `wait:${week.id}`, weekId: week.id, kind: "calc" },
              `Giornata ${week.number}: non calcolata, manca ${held.map(labelOf).join(", ")}. Si calcola dopo il recupero.`,
            );
          }
        }
      } else if (page.votes.length > 0 && week.status !== "scored") {
        await deps.writeProjection(week, page.votes);
        report.projected.push(week.number);
        for (const task of claimed) {
          const read = week.matches.filter((match) => task.matchIds.includes(match.id));
          await deps.reportVotes({ gameweek: week.number, label: LABEL[task.kind], matches: reportMatches(page, read, () => false) });
        }
      }
      for (const { task, problem } of provisional) {
        await finish(task, problem ? "not_ready" : "ok", problem ?? "");
        done.add(task.key);
        if (problem) report.waiting.push({ gameweekNumber: week.number, matchId: task.matchIds[0] ?? "", reason: problem });
      }
    } catch (error) {
      report.errors.push({ gameweekNumber: week.number, matchId: null, message: text(error) });
      for (const task of claimed) {
        if (!done.has(task.key)) await finish(task, "error", text(error));
      }
    }
  }

  // 3. Avvisi: tentativi finiti senza voti, o lettura decisiva persa.
  for (const task of [...attempted, ...plan.alerts]) {
    if (!needsAlert(task, reads, now)) continue;
    const week = snapshot.weeks.find((item) => item.id === task.weekId);
    const rows = reads.filter((row) => row.key === task.key && row.attempt > 0);
    const matches = week?.matches.filter((match) => task.matchIds.includes(match.id)).map(labelOf).join(", ");
    const subject = week ? `Giornata ${week.number}, lettura di ${LABEL[task.kind]}` : "Aggiornamento del calendario";
    const reason = rows.length === 0 ? "nessun tentativo eseguito in tempo" : `fallita dopo ${rows.length} tentativ${rows.length === 1 ? "o" : "i"}`;
    const errors = report.errors.filter((item) => item.gameweekNumber === (week?.number ?? null)).map((item) => item.message);
    const waiting = report.waiting.filter((item) => task.matchIds.includes(item.matchId)).map((item) => item.reason);
    const detail = [...new Set([...errors, ...waiting])].slice(0, 5).join("; ");
    const effect = task.kind === "morning" ? " La giornata non viene calcolata: controlla e usa «Forza sync voti ora»." : "";
    await alertOnce(task, `${subject}: ${reason}.${matches ? ` Partite: ${matches}.` : ""}${detail ? ` ${detail}.` : ""}${effect}`);
  }

  // 4. Calcolo: solo dopo la lettura della mattina riuscita e con tutte le partite complete.
  for (const week of snapshot.weeks) {
    if (!readyToCalculate(week, reads)) continue;
    const reason = await calculateWeek(deps, week, false, report);
    if (reason) await alertOnce({ key: `calc:${week.id}`, weekId: week.id, kind: "calc" }, `Giornata ${week.number}: calcolo non riuscito. ${reason}`);
  }

  return report;
}

/**
 * «Forza sync voti ora»: legge subito, senza contare i tentativi. Prima delle 08:00 successive
 * al turno resta provvisorio; dopo scrive i voti ufficiali e calcola, solo se tutto è completo.
 */
export async function runManualRead(deps: ClockDeps, now: number): Promise<CycleReport> {
  const report = emptyReport();
  const snapshot = await deps.snapshot();
  for (const week of snapshot.weeks) {
    if (week.status === "final") continue;
    const started = playableMatches(week).filter((match) => new Date(match.kickoffAt).getTime() + 50 * 60_000 <= now);
    const useful = week.status === "scored" ? started.filter((match) => match.status !== "finished") : started;
    if (useful.length === 0) continue;
    const morning = voteTasks(week, false).find((task) => task.kind === "morning");
    const official = morning !== undefined && now >= morning.due;
    try {
      if (startedUnlocked(week, now)) {
        await deps.lockWeek(week);
        week.status = "locked";
      }
      const page = await deps.fetchPage(week);
      report.reads.push(`richiesta manuale G${week.number}`);
      if (!official) {
        if (page.votes.length > 0 && week.status !== "scored") {
          await deps.writeProjection(week, page.votes);
          report.projected.push(week.number);
          await deps.reportVotes({ gameweek: week.number, label: "lettura manuale", matches: reportMatches(page, started, () => false) });
        }
        continue;
      }
      const missing = await writeCompleteMatches(deps, week, page, now, report);
      const projected = missing.length > 0 && page.votes.length > 0 && week.status !== "scored";
      if (projected) await deps.writeProjection(week, page.votes);
      await reportOfficial(deps, week, page, report, "lettura manuale", projected);
      if (missing.length > 0) continue;
      await rescoreRecovery(deps, week, report);
      if (week.status !== "scored" && week.number >= AUTO_CALC_FROM_GAMEWEEK && week.matches.every((match) => match.status === "finished")) {
        await calculateWeek(deps, week, false, report);
      }
    } catch (error) {
      report.errors.push({ gameweekNumber: week.number, matchId: null, message: text(error) });
    }
  }
  return report;
}
