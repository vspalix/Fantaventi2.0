import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { writeSuiteStamp } from "@/lib/server/engine-suite-report";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { runReadLatencyBench } from "@/lib/testing/queryLatencyBench";
import { runScoringEngineTestSuite, withChecks } from "@/lib/testing/scoringEngineTestSuite";

function millis(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = await request.json().catch(() => ({} as { simulateNetworkLatency?: boolean }));
    const started = performance.now();
    const engine = await runScoringEngineTestSuite({
      simulateNetworkLatency: body.simulateNetworkLatency !== false,
    });
    const queries = await runReadLatencyBench();
    const report = withChecks(engine, queries);
    report.durationMs = millis(performance.now() - started);
    report.finishedAt = new Date().toISOString();
    const clean = report.checks.every((check) => check.status === "PASSED");
    writeSuiteStamp({
      finishedAt: report.finishedAt,
      status: clean ? "PASSED" : "FAILED",
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
      total: report.checks.length,
      source: "admin",
    });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
