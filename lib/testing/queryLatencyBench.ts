import { createAdminSupabase } from "@/lib/supabase/admin";
import { QUERY_BUDGET_MS, type TestCheck } from "@/lib/testing/scoringEngineTestSuite";

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function timedCheck(
  id: string,
  name: string,
  durationMs: number,
  detail: string,
  failedMessage?: string,
): TestCheck {
  const over = failedMessage ? null : round2(durationMs - QUERY_BUDGET_MS);
  const passed = !failedMessage && durationMs <= QUERY_BUDGET_MS;
  return {
    id,
    block: "Query",
    name,
    status: passed ? "PASSED" : "FAILED",
    expected: failedMessage ? "lettura riuscita" : `<= ${QUERY_BUDGET_MS.toFixed(2)} ms`,
    actual: failedMessage ?? `${durationMs.toFixed(2)} ms · ${detail}`,
    delta: failedMessage ? null : `${over && over > 0 ? "+" : ""}${over?.toFixed(2) ?? "0.00"} ms`,
    durationMs: round2(durationMs),
    budgetMs: QUERY_BUDGET_MS,
    bottleneck: passed ? null : (failedMessage ? name : name),
  };
}

async function timeQuery<T>(run: () => PromiseLike<{ data: T; error: { message: string } | null }>) {
  const start = performance.now();
  const result = await run();
  return { durationMs: performance.now() - start, data: result.data, error: result.error?.message ?? null };
}

export async function runReadLatencyBench(): Promise<TestCheck[]> {
  const checks: TestCheck[] = [];
  const admin = createAdminSupabase();
  let roundTrips = 0;

  const seasons = await timeQuery(() => admin.from("seasons").select("id, code").limit(1));
  roundTrips += 1;
  checks.push(timedCheck(
    "Q1",
    "Lettura stagione",
    seasons.durationMs,
    "seasons",
    seasons.error ?? undefined,
  ));

  const weeks = await timeQuery(() => admin
    .from("gameweeks")
    .select("id, number, status")
    .in("status", ["open", "locked", "scored", "final"])
    .order("number", { ascending: false })
    .limit(1));
  roundTrips += 1;
  checks.push(timedCheck(
    "Q2",
    "Lettura giornata attiva o già calcolata",
    weeks.durationMs,
    "gameweeks",
    weeks.error ?? undefined,
  ));

  const players = await timeQuery(() => admin.from("players").select("id").limit(20));
  roundTrips += 1;
  checks.push(timedCheck(
    "Q3",
    "Lettura listone, venti righe",
    players.durationMs,
    "players",
    players.error ?? undefined,
  ));

  const gameweekId = Array.isArray(weeks.data) ? (weeks.data[0]?.id as string | undefined) : undefined;
  if (!gameweekId) {
    checks.push({
      id: "Q4",
      block: "Query",
      name: "Rose e voti della giornata",
      status: "SKIPPED",
      expected: "una giornata",
      actual: "Nessuna giornata da misurare",
      delta: null,
      durationMs: 0,
      budgetMs: QUERY_BUDGET_MS,
      bottleneck: null,
    });
    return checks;
  }

  const statsStarted = performance.now();
  const stats = await admin
    .from("player_gameweek_stats")
    .select("player_id, voto")
    .eq("gameweek_id", gameweekId)
    .limit(40);
  const statsMs = performance.now() - statsStarted;
  roundTrips += 1;
  checks.push(timedCheck(
    "Q4",
    "Voti della giornata, una query",
    statsMs,
    "player_gameweek_stats",
    stats.error?.message,
  ));

  const lineupsStarted = performance.now();
  const lineups = await admin
    .from("lineups")
    .select("fantasy_team_id, lineup_slots(player_id)")
    .eq("gameweek_id", gameweekId);
  const lineupsMs = performance.now() - lineupsStarted;
  roundTrips += 1;
  checks.push(timedCheck(
    "Q5",
    "Rose della giornata con gli slot, una query",
    lineupsMs,
    `${lineups.data?.length ?? 0} rose`,
    lineups.error?.message,
  ));

  const paired = round2(statsMs + lineupsMs);
  const pairedOver = round2(paired - QUERY_BUDGET_MS);
  const pairedPassed = !stats.error && !lineups.error && paired <= QUERY_BUDGET_MS && roundTrips <= 6;
  checks.push({
    id: "Q6",
    block: "Query",
    name: "Rose e voti insieme restano due round trip, sotto il budget",
    status: pairedPassed ? "PASSED" : "FAILED",
    expected: `2 round trip, <= ${QUERY_BUDGET_MS.toFixed(2)} ms, totale letture <= 6`,
    actual: `2 round trip, ${paired.toFixed(2)} ms, letture totali ${roundTrips}`,
    delta: `${pairedOver > 0 ? "+" : ""}${pairedOver.toFixed(2)} ms`,
    durationMs: paired,
    budgetMs: QUERY_BUDGET_MS,
    bottleneck: pairedPassed ? null : "query lenta su rose o voti",
  });

  return checks;
}
