import { createAdminSupabase } from "@/lib/supabase/admin";
import { readSuiteBook } from "@/lib/server/engine-suite-report";
import { probePooler, readPoolerConfig, transactionClient } from "@/lib/server/pooler";
import { recentSamples, type LatencySample } from "@/lib/server/telemetry";
import {
  LATENCY_BUDGET_MS,
  type HealthAlert,
  type HealthOperation,
  type HourBucket,
  type KickoffPeak,
  type SystemHealth,
} from "@/lib/system-health";

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 24 * HOUR_MS;
const OPERATIONS = new Set<HealthOperation>(["roster", "lineup-save", "vote-fetch", "gameweek-calc"]);

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function asOperation(value: unknown): HealthOperation | null {
  return typeof value === "string" && OPERATIONS.has(value as HealthOperation) ? (value as HealthOperation) : null;
}

function asIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapRow(row: {
  operation: unknown;
  duration_ms: unknown;
  ok: unknown;
  timed_out: unknown;
  detail: unknown;
  recorded_at: unknown;
}): LatencySample | null {
  const operation = asOperation(row.operation);
  const recordedAt = asIso(row.recorded_at);
  const durationMs = Number(row.duration_ms);
  if (!operation || !recordedAt || !Number.isFinite(durationMs)) return null;
  return {
    operation,
    durationMs,
    ok: row.ok !== false,
    timeout: row.timed_out === true,
    detail: typeof row.detail === "string" ? row.detail : null,
    recordedAt,
  };
}

async function storedSamples(): Promise<LatencySample[]> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const config = readPoolerConfig();
  if (config.kind === "ready") {
    try {
      const sql = transactionClient();
      if (!sql) return [];
      const rows = await sql<Array<{
        operation: string;
        duration_ms: string | number;
        ok: boolean;
        timed_out: boolean;
        detail: string | null;
        recorded_at: Date | string;
      }>>`
        select operation, duration_ms, ok, timed_out, detail, recorded_at
        from ops_latency
        where recorded_at >= ${since}
        order by recorded_at desc
        limit 2000
      `;
      return rows.flatMap((row) => {
        const sample = mapRow(row);
        return sample ? [sample] : [];
      });
    } catch {
      return [];
    }
  }
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("ops_latency")
      .select("operation, duration_ms, ok, timed_out, detail, recorded_at")
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false })
      .limit(2000);
    if (error || !data) return [];
    return data.flatMap((row) => {
      const sample = mapRow(row);
      return sample ? [sample] : [];
    });
  } catch {
    return [];
  }
}

function mergeSamples(memory: LatencySample[], stored: LatencySample[]) {
  const seen = new Set<string>();
  const merged: LatencySample[] = [];
  for (const sample of [...stored, ...memory]) {
    const key = `${sample.operation}|${new Date(sample.recordedAt).getTime()}|${Math.round(sample.durationMs)}|${sample.ok}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(sample);
  }
  merged.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  return merged;
}

function buckets(samples: LatencySample[], now: number): HourBucket[] {
  const start = now - WINDOW_MS;
  const hours: HourBucket[] = Array.from({ length: 24 }, (_, index) => ({
    from: new Date(start + index * HOUR_MS).toISOString(),
    averageMs: 0,
    maxMs: 0,
    count: 0,
  }));
  const sums = new Array<number>(24).fill(0);
  for (const sample of samples) {
    const elapsed = new Date(sample.recordedAt).getTime() - start;
    let index = Math.floor(elapsed / HOUR_MS);
    if (index === 24) index = 23;
    if (index < 0 || index > 23) continue;
    hours[index].count += 1;
    hours[index].maxMs = Math.max(hours[index].maxMs, sample.durationMs);
    sums[index] += sample.durationMs;
  }
  return hours.map((hour, index) => ({
    ...hour,
    averageMs: hour.count ? round(sums[index] / hour.count) : 0,
    maxMs: round(hour.maxMs),
  }));
}

async function kickoffs(now: number) {
  try {
    const admin = createAdminSupabase();
    const since = new Date(now - 48 * HOUR_MS).toISOString();
    const until = new Date(now + 6 * HOUR_MS).toISOString();
    const { data, error } = await admin
      .from("real_matches")
      .select("kickoff_at")
      .gte("kickoff_at", since)
      .lte("kickoff_at", until)
      .order("kickoff_at", { ascending: true });
    if (error || !data) return [];
    const times = new Set<number>();
    for (const row of data) {
      const time = new Date(String(row.kickoff_at)).getTime();
      if (Number.isFinite(time)) times.add(time);
    }
    return [...times].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function peakBeforeKickoff(samples: LatencySample[], times: number[], now: number): KickoffPeak | null {
  const candidates = times.filter((time) => time <= now + HOUR_MS);
  let best: KickoffPeak | null = null;
  for (const kickoff of candidates) {
    const from = kickoff - HOUR_MS;
    for (const sample of samples) {
      const at = new Date(sample.recordedAt).getTime();
      if (at < from || at > kickoff) continue;
      if (!best || sample.durationMs > best.durationMs || (sample.durationMs === best.durationMs && kickoff > new Date(best.kickoffAt).getTime())) {
        best = { kickoffAt: new Date(kickoff).toISOString(), durationMs: round(sample.durationMs), operation: sample.operation };
      }
    }
  }
  return best;
}

function alerts(samples: LatencySample[]): HealthAlert[] {
  return samples
    .filter((sample) => !sample.ok || sample.timeout || sample.durationMs > LATENCY_BUDGET_MS)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, 30)
    .map((sample) => ({
      operation: sample.operation,
      durationMs: round(sample.durationMs),
      timeout: sample.timeout,
      ok: sample.ok,
      detail: sample.detail,
      recordedAt: sample.recordedAt,
    }));
}

async function probeDatabase() {
  const started = performance.now();
  try {
    const admin = createAdminSupabase();
    const { error } = await admin.from("seasons").select("id").limit(1);
    if (error) {
      return { up: false, latencyMs: null as number | null, detail: error.message.slice(0, 180) };
    }
    return {
      up: true,
      latencyMs: Math.round(performance.now() - started),
      detail: "La Data API risponde.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database non raggiungibile.";
    return { up: false, latencyMs: null as number | null, detail: message.slice(0, 180) };
  }
}

export async function loadSystemHealth(): Promise<SystemHealth> {
  const now = Date.now();
  const [pooler, database, stored, times] = await Promise.all([
    probePooler(),
    probeDatabase(),
    storedSamples(),
    kickoffs(now),
  ]);
  const samples = mergeSamples(recentSamples(), stored);
  const durations = samples.map((sample) => sample.durationMs);
  return {
    pooler: {
      up: pooler.up,
      label: "Pooler",
      detail: pooler.detail,
      latencyMs: pooler.latencyMs,
      port: 6543,
      mode: "transaction",
    },
    database: {
      up: database.up,
      label: "Database",
      detail: database.detail,
      latencyMs: database.latencyMs,
    },
    averageMs: durations.length ? round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    maxMs: durations.length ? round(Math.max(...durations)) : null,
    sampleCount: samples.length,
    hours: buckets(samples, now),
    peak: peakBeforeKickoff(samples, times, now),
    alerts: alerts(samples),
    suite: readSuiteBook(),
  };
}
