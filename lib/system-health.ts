export const LATENCY_BUDGET_MS = 1000;

export type HealthOperation = "roster" | "lineup-save" | "vote-fetch" | "gameweek-calc";

export type ConnectionState = {
  up: boolean;
  label: string;
  detail: string;
  latencyMs: number | null;
};

export type HourBucket = {
  from: string;
  averageMs: number;
  maxMs: number;
  count: number;
};

export type HealthAlert = {
  operation: HealthOperation;
  durationMs: number;
  timeout: boolean;
  ok: boolean;
  detail: string | null;
  recordedAt: string;
};

export type SuiteStamp = {
  finishedAt: string;
  status: "PASSED" | "FAILED";
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  source: "ci" | "admin";
};

export type KickoffPeak = {
  kickoffAt: string;
  durationMs: number;
  operation: HealthOperation;
};

export type SystemStatus = {
  success: boolean;
  pooler: {
    up: boolean;
    port: 6543;
    mode: "transaction";
    latencyMs: number | null;
    detail: string;
  } | null;
  database: {
    up: boolean;
    latencyMs: number | null;
    detail: string;
  };
  error?: string;
};

export type SystemHealth = {
  pooler: ConnectionState & { port: 6543; mode: "transaction" };
  database: ConnectionState;
  averageMs: number | null;
  maxMs: number | null;
  sampleCount: number;
  hours: HourBucket[];
  peak: KickoffPeak | null;
  alerts: HealthAlert[];
  suite: { ci: SuiteStamp | null; admin: SuiteStamp | null };
};
