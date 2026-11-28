import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { realExternalCallsAllowed } from "@/lib/outbound";
import { writeSuiteStamp } from "@/lib/server/engine-suite-report";
import { runReadLatencyBench } from "@/lib/testing/queryLatencyBench";
import { runScoringEngineTestSuite, withChecks, type EngineTestReport } from "@/lib/testing/scoringEngineTestSuite";
import { runAnnouncementChecks } from "./test-announcements";
import { runErrorReportChecks } from "./test-error-report";
import { runHomeRoundChecks } from "./test-home-round";
import { runLeagueStartChecks } from "./test-league-start";
import { runLineupAndPointsChecks } from "./test-lineup-and-points";
import { runLineupSaveChecks } from "./test-lineup-save";
import { runMatchdayLifecycle } from "./test-matchday-lifecycle";
import { runLineupReminderChecks } from "./test-lineup-reminder";
import { runLiveGapChecks } from "./test-live-gaps";
import { runMenuTitleChecks } from "./test-menu-titles";
import { installTestNetworkGuard, removeSendingKeys } from "./test-guard";
import { runRulesCoverage } from "./test-rules-coverage";
import { runSubstitutionChecks } from "./test-substitutions";
import { runVoteScheduleChecks } from "./test-vote-schedule";

const ENGINE_MIN = 34;
const FULL_SUITE = 40;

// Sul PC le verifiche non leggono .env.local, quindi non toccano il database vero.
// Si può chiedere apposta con ALLOW_REAL_EXTERNAL_CALLS=true. Su Vercel e GitHub le variabili
// arrivano già dall'ambiente e restano come prima.
const envFile = path.join(process.cwd(), ".env.local");
if (realExternalCallsAllowed() && existsSync(envFile)) process.loadEnvFile(envFile);
// Dalle verifiche non parte niente, nemmeno su Vercel o con le chiavi aperte.
removeSendingKeys();
installTestNetworkGuard();

function stampFrom(report: EngineTestReport, source: "ci") {
  const clean = report.checks.every((check) => check.status === "PASSED");
  return writeSuiteStamp({
    finishedAt: report.finishedAt,
    status: clean ? "PASSED" : "FAILED",
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped,
    total: report.checks.length,
    source,
  });
}

async function main() {
  const started = performance.now();
  const engine = await runScoringEngineTestSuite({ simulateNetworkLatency: true });
  const hasDatabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  let report = engine;
  if (hasDatabase) {
    const queries = await runReadLatencyBench();
    report = withChecks(engine, queries);
  }
  report.durationMs = Math.round(performance.now() - started);
  report.finishedAt = new Date().toISOString();
  stampFrom(report, "ci");

  const broken = report.checks.filter((check) => check.status !== "PASSED");
  console.log(`Suite motore: ${broken.length === 0 ? "PASSED" : "FAILED"} ${report.passed}/${report.checks.length} in ${report.durationMs} ms`);
  for (const check of broken) {
    console.log(`- ${check.id} ${check.name}: ${check.actual}`);
  }

  if (engine.checks.length < ENGINE_MIN) {
    console.error(`La suite motore ha ${engine.checks.length} controlli. Il minimo è ${ENGINE_MIN}.`);
    process.exit(1);
  }
  if (hasDatabase && report.checks.length < FULL_SUITE) {
    console.error(`Con il database la suite deve coprire ${FULL_SUITE} controlli. Ne ha ${report.checks.length}.`);
    process.exit(1);
  }
  const lifecycle = runMatchdayLifecycle();
  console.log(`Ciclo giornata: ${lifecycle.passed ? "PASSED" : "FAILED"} ${lifecycle.passedCount}/${lifecycle.total}`);
  for (const step of lifecycle.steps) {
    console.log(`- ${step.passed ? "PASS" : "FAIL"} ${step.name}: ${step.detail}`);
  }

  const substitutions = runSubstitutionChecks();
  console.log(`Sostituzioni e modulo: ${substitutions.failures.length === 0 ? "PASSED" : "FAILED"} ${substitutions.passed}/${substitutions.total}`);
  for (const failure of substitutions.failures) console.log(`- ${failure}`);

  const rules = runRulesCoverage();
  console.log(`Regole, parser e avvisi: ${rules.failures.length === 0 ? "PASSED" : "FAILED"} ${rules.passed}/${rules.total}`);
  for (const failure of rules.failures) console.log(`- ${failure}`);

  const gaps = await runLiveGapChecks();
  console.log(`Lacune reali: ${gaps.failures.length === 0 ? "PASSED" : "FAILED"} ${gaps.passed}/${gaps.total}`);
  for (const failure of gaps.failures) console.log(`- ${failure}`);

  const schedule = await runVoteScheduleChecks();
  console.log(`Letture dei voti: ${schedule.failures.length === 0 ? "PASSED" : "FAILED"} ${schedule.passed}/${schedule.total}`);
  for (const failure of schedule.failures) console.log(`- ${failure}`);

  const errors = await runErrorReportChecks();
  console.log(`Errori e avvisi: ${errors.failures.length === 0 ? "PASSED" : "FAILED"} ${errors.passed}/${errors.total}`);
  for (const failure of errors.failures) console.log(`- ${failure}`);

  const lineups = await runLineupAndPointsChecks();
  console.log(`Formazioni, rigori e voti salvati: ${lineups.failures.length === 0 ? "PASSED" : "FAILED"} ${lineups.passed}/${lineups.total}`);
  for (const failure of lineups.failures) console.log(`- ${failure}`);

  const lineupSave = await runLineupSaveChecks();
  console.log(`Salvataggi contemporanei: ${lineupSave.failures.length === 0 ? "PASSED" : "FAILED"} ${lineupSave.passed}/${lineupSave.total}`);
  for (const failure of lineupSave.failures) console.log(`- ${failure}`);

  const reminders = await runLineupReminderChecks();
  console.log(`Promemoria formazioni: ${reminders.failures.length === 0 ? "PASSED" : "FAILED"} ${reminders.passed}/${reminders.total}`);
  for (const failure of reminders.failures) console.log(`- ${failure}`);

  const leagueStart = runLeagueStartChecks();
  console.log(`Inizio lega e impostazioni: ${leagueStart.failures.length === 0 ? "PASSED" : "FAILED"} ${leagueStart.passed}/${leagueStart.total}`);
  for (const failure of leagueStart.failures) console.log(`- ${failure}`);

  const history = runIsolated("test-rule-history.ts");
  console.log(`Bonus cambiati a lega iniziata: ${history.failures.length === 0 ? "PASSED" : "FAILED"} ${history.passed}/${history.total}`);
  for (const failure of history.failures) console.log(`- ${failure}`);

  const office = runIsolated("test-office-lineup-live.ts");
  console.log(`Formazione d'ufficio in diretta: ${office.failures.length === 0 ? "PASSED" : "FAILED"} ${office.passed}/${office.total}`);
  for (const failure of office.failures) console.log(`- ${failure}`);

  const announcements = runAnnouncementChecks();
  console.log(`Annunci: ${announcements.failures.length === 0 ? "PASSED" : "FAILED"} ${announcements.passed}/${announcements.total}`);
  for (const failure of announcements.failures) console.log(`- ${failure}`);

  const homeRound = runHomeRoundChecks();
  console.log(`Giornata in Dashboard e Live: ${homeRound.failures.length === 0 ? "PASSED" : "FAILED"} ${homeRound.passed}/${homeRound.total}`);
  for (const failure of homeRound.failures) console.log(`- ${failure}`);

  const titles = runMenuTitleChecks();
  console.log(`Titoli come il menu: ${titles.failures.length === 0 ? "PASSED" : "FAILED"} ${titles.passed}/${titles.total}`);
  for (const failure of titles.failures) console.log(`- ${failure}`);

  const rivals = runIsolated("test-calendar-rivals.ts");
  console.log(`Più scelti dagli avversari: ${rivals.failures.length === 0 ? "PASSED" : "FAILED"} ${rivals.passed}/${rivals.total}`);
  for (const failure of rivals.failures) console.log(`- ${failure}`);

  const outbound = runIsolated("test-outbound.ts");
  console.log(`Niente invii veri in locale: ${outbound.failures.length === 0 ? "PASSED" : "FAILED"} ${outbound.passed}/${outbound.total}`);
  for (const failure of outbound.failures) console.log(`- ${failure}`);

  const hallOfFame = runIsolated("test-hall-of-fame.ts");
  console.log(`Albo d'oro: ${hallOfFame.failures.length === 0 ? "PASSED" : "FAILED"} ${hallOfFame.passed}/${hallOfFame.total}`);
  for (const failure of hallOfFame.failures) console.log(`- ${failure}`);

  const largeLeague = runIsolated("test-large-league.ts");
  console.log(`Leghe grandi: ${largeLeague.failures.length === 0 ? "PASSED" : "FAILED"} ${largeLeague.passed}/${largeLeague.total}`);
  for (const failure of largeLeague.failures) console.log(`- ${failure}`);

  const total = largeLeague.total + hallOfFame.total + report.checks.length + lifecycle.total + substitutions.total + rules.total + gaps.total + schedule.total + errors.total + lineups.total + lineupSave.total + reminders.total + leagueStart.total + office.total + announcements.total + homeRound.total + outbound.total + titles.total + history.total + rivals.total;
  const passed = largeLeague.passed + hallOfFame.passed + report.passed + lifecycle.passedCount + substitutions.passed + rules.passed + gaps.passed + schedule.passed + errors.passed + lineups.passed + lineupSave.passed + reminders.passed + leagueStart.passed + office.passed + announcements.passed + homeRound.passed + outbound.passed + titles.passed + history.passed + rivals.passed;
  console.log(`Verifica complessiva: ${passed}/${total}`);

  if (broken.length > 0 || !lifecycle.passed || substitutions.failures.length > 0 || rules.failures.length > 0 || gaps.failures.length > 0 || schedule.failures.length > 0 || errors.failures.length > 0 || lineups.failures.length > 0 || lineupSave.failures.length > 0 || reminders.failures.length > 0 || leagueStart.failures.length > 0 || office.failures.length > 0 || announcements.failures.length > 0 || homeRound.failures.length > 0 || outbound.failures.length > 0 || titles.failures.length > 0 || history.failures.length > 0 || hallOfFame.failures.length > 0 || largeLeague.failures.length > 0 || rivals.failures.length > 0 || total < 100) process.exit(1);
}

/**
 * Queste prove girano in un processo a parte, senza le variabili del database vero e delle chiavi:
 * così non toccano mai niente di vero, nemmeno quando `.env.local` è presente.
 */
function runIsolated(script: string) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/SUPABASE|TELEGRAM|VAPID|CRON_SECRET|DATABASE_URL|POSTGRES|RESEND|API_FOOTBALL|^ALLOW_REAL|^VERCEL|^AWS_LAMBDA/i.test(name)) delete env[name];
  }
  const run = spawnSync(process.execPath, ["--import", "tsx", path.join("scripts", script)], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = `${run.stdout ?? ""}`;
  const summary = output.match(/(PASSED|FAILED) (\d+)\/(\d+)/);
  if (!summary) {
    return { total: 1, passed: 0, failures: ["prova non eseguita"] };
  }
  const failures = output.split(/\r?\n/).filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
  if (run.status !== 0 && failures.length === 0) failures.push("prova interrotta");
  return { total: Number(summary[3]), passed: Number(summary[2]), failures };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Suite non eseguita.";
  console.error(message.includes("://") ? "Suite non eseguita." : message);
  process.exit(1);
});
