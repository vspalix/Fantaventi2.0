import { createAdminSupabase } from "@/lib/supabase/admin";
import { LATENCY_BUDGET_MS, type HealthOperation } from "@/lib/system-health";
import { assertTransactionLane, readPoolerConfig, transactionClient } from "@/lib/server/pooler";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLES = 2000;

export type LatencySample = {
  operation: HealthOperation;
  durationMs: number;
  ok: boolean;
  timeout: boolean;
  detail: string | null;
  recordedAt: string;
};

const samples: LatencySample[] = [];
let tableMissingUntil = 0;

function isTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted|ETIMEDOUT|statement timeout/i.test(message);
}

function safeDetail(error: unknown) {
  const message = error instanceof Error ? error.message : "errore";
  if (message.includes("://") || message.includes("@")) return "Errore di connessione.";
  return message.slice(0, 160);
}

function trim() {
  const cutoff = Date.now() - WINDOW_MS;
  while (samples.length && new Date(samples[0].recordedAt).getTime() < cutoff) samples.shift();
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function remember(
  operation: HealthOperation,
  durationMs: number,
  ok: boolean,
  timeout: boolean,
  detail: string | null,
) {
  const sample: LatencySample = {
    operation,
    durationMs: Math.round(durationMs * 1000) / 1000,
    ok,
    timeout,
    detail,
    recordedAt: new Date().toISOString(),
  };
  samples.push(sample);
  trim();
  void persist(sample);
  return sample;
}

function pauseWrites() {
  tableMissingUntil = Date.now() + 60_000;
}

async function persist(sample: LatencySample) {
  if (Date.now() < tableMissingUntil) return;
  const config = readPoolerConfig();
  try {
    if (config.kind === "ready") {
      const sql = transactionClient();
      if (!sql) return;
      await sql`
        insert into ops_latency (operation, duration_ms, ok, timed_out, detail, recorded_at)
        values (
          ${sample.operation},
          ${sample.durationMs},
          ${sample.ok},
          ${sample.timeout},
          ${sample.detail},
          ${sample.recordedAt}
        )
      `;
      return;
    }
    if (config.kind === "invalid") return;
    const admin = createAdminSupabase();
    const { error } = await admin.from("ops_latency").insert({
      operation: sample.operation,
      duration_ms: sample.durationMs,
      ok: sample.ok,
      timed_out: sample.timeout,
      detail: sample.detail,
      recorded_at: sample.recordedAt,
    });
    if (error && /ops_latency|schema cache|could not find|relation/i.test(error.message)) pauseWrites();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/ops_latency|does not exist|schema cache|42P01|relation/i.test(message)) pauseWrites();
  }
}

export function recentSamples() {
  trim();
  return samples.slice();
}

export function latencyBudgetMs() {
  return LATENCY_BUDGET_MS;
}

export async function meter<T>(operation: HealthOperation, run: () => Promise<T>): Promise<T> {
  try {
    assertTransactionLane();
  } catch (error) {
    remember(operation, 0, false, false, safeDetail(error));
    throw error;
  }
  const started = performance.now();
  try {
    const value = await run();
    remember(operation, performance.now() - started, true, false, null);
    return value;
  } catch (error) {
    remember(operation, performance.now() - started, false, isTimeout(error), safeDetail(error));
    throw error;
  }
}
