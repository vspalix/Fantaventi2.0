import { existsSync } from "node:fs";
import path from "node:path";
import { writeSuiteStamp } from "@/lib/server/engine-suite-report";
import { runReadLatencyBench } from "@/lib/testing/queryLatencyBench";
import { runScoringEngineTestSuite, withChecks, type EngineTestReport } from "@/lib/testing/scoringEngineTestSuite";

const ENGINE_MIN = 34;
const FULL_SUITE = 40;

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

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
  if (broken.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Suite non eseguita.";
  console.error(message.includes("://") ? "Suite non eseguita." : message);
  process.exit(1);
});
