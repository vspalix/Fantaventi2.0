import postgres from "postgres";

export class LaneError extends Error {
  status = 500;
}

type PoolerConfig =
  | { kind: "missing" }
  | { kind: "invalid"; reason: string }
  | { kind: "ready"; url: string };

let sql: ReturnType<typeof postgres> | null = null;
let openedFor: string | null = null;

function connectionString() {
  return (process.env.SUPABASE_POOLER_URL || process.env.DATABASE_URL || "").trim();
}

export function readPoolerConfig(): PoolerConfig {
  const raw = connectionString();
  if (!raw) return { kind: "missing" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "invalid", reason: "SUPABASE_POOLER_URL non è un indirizzo leggibile." };
  }
  const port = url.port || "5432";
  if (port !== "6543") {
    return {
      kind: "invalid",
      reason: `La porta configurata è ${port}. Il laboratorio apre solo il pooler in Transaction Mode sulla porta 6543.`,
    };
  }
  return { kind: "ready", url: raw };
}

export function transactionClient() {
  const config = readPoolerConfig();
  if (config.kind !== "ready") return null;
  if (sql && openedFor === config.url) return sql;
  if (sql) void sql.end({ timeout: 1 });
  sql = postgres(config.url, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 8,
    ssl: "require",
  });
  openedFor = config.url;
  return sql;
}

export function assertTransactionLane() {
  const config = readPoolerConfig();
  if (config.kind === "invalid") throw new LaneError(config.reason);
  if (config.kind === "ready") transactionClient();
}

function safeDbError(error: unknown) {
  const message = error instanceof Error ? error.message : "Connessione al pooler non riuscita.";
  if (message.includes("://") || message.includes("@")) return "Connessione al pooler non riuscita.";
  return message.slice(0, 180);
}

export async function probePooler() {
  const config = readPoolerConfig();
  if (config.kind === "missing") {
    return {
      up: false,
      latencyMs: null as number | null,
      detail: "Manca SUPABASE_POOLER_URL. Incolla la stringa del pooler in Transaction Mode, porta 6543.",
    };
  }
  if (config.kind === "invalid") {
    return { up: false, latencyMs: null as number | null, detail: config.reason };
  }
  const started = performance.now();
  try {
    const client = transactionClient();
    if (!client) throw new LaneError("Pooler non aperto.");
    await client`select 1 as ok`;
    return {
      up: true,
      latencyMs: Math.round(performance.now() - started),
      detail: "Connesso in Transaction Mode sulla porta 6543.",
    };
  } catch (error) {
    return { up: false, latencyMs: null as number | null, detail: safeDbError(error) };
  }
}
