import { playedDayStillOpen } from "@/lib/server/vote-sync-window";
import { readSyncLogs, readSystemSettings, type SyncLogRow } from "@/lib/server/system-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type DiagnosticJob = {
  jobType: "votes" | "availability" | "kickoffs";
  label: string;
  status: "success" | "skipped" | "error" | "missing";
  at: string | null;
  origin: "cron" | "manual" | null;
  recordsWritten: number;
  message: string;
};

export type MatchdaySnapshot = {
  label: string;
  phase: string;
  deadlineAt: string | null;
  firstKickoffAt: string | null;
  matchesLabel: string;
  behind: number[];
};

export type OpsDiagnostics = {
  jobs: DiagnosticJob[];
  logs: SyncLogRow[];
  anomalies: string[];
  matchday: MatchdaySnapshot;
  telegramConfigured: boolean;
  notifyOnSyncSuccess: boolean;
};

const JOBS = [
  { jobType: "votes" as const, label: "Voti" },
  { jobType: "availability" as const, label: "Indisponibili" },
  { jobType: "kickoffs" as const, label: "Orari" },
];

const PHASE: Record<string, string> = {
  scheduled: "In programma",
  open: "Formazione aperta",
  locked: "Formazione bloccata",
  scored: "Calcolata",
  final: "Chiusa",
};

function latest(logs: SyncLogRow[], jobType: DiagnosticJob["jobType"]): DiagnosticJob {
  const row = logs.find((item) => item.jobType === jobType);
  const label = JOBS.find((job) => job.jobType === jobType)?.label ?? jobType;
  if (!row) {
    return { jobType, label, status: "missing", at: null, origin: null, recordsWritten: 0, message: "Nessun giro registrato." };
  }
  return {
    jobType,
    label,
    status: row.status,
    at: row.createdAt,
    origin: row.triggerSource,
    recordsWritten: row.recordsWritten,
    message: row.message || "Nessun dettaglio.",
  };
}

async function currentMatchday(): Promise<MatchdaySnapshot> {
  const empty: MatchdaySnapshot = {
    label: "Giornata non disponibile",
    phase: "Dato non letto",
    deadlineAt: null,
    firstKickoffAt: null,
    matchesLabel: "Partite non lette.",
    behind: [],
  };
  try {
    const admin = createAdminSupabase();
    const seasons = await admin.from("seasons").select("id, code, competitions!inner(code)").order("starts_on", { ascending: false });
    if (seasons.error) return { ...empty, matchesLabel: seasons.error.message };
    const season = (seasons.data ?? []).find((row) => {
      const competition = Array.isArray(row.competitions) ? row.competitions[0] : row.competitions;
      return competition?.code === "serie_a";
    });
    if (!season) return { ...empty, label: "Nessuna stagione Serie A", phase: "Assente" };
    const weeks = await admin
      .from("gameweeks")
      .select("id, number, status, deadline_at")
      .eq("season_id", season.id)
      .order("number", { ascending: true });
    if (weeks.error) return { ...empty, matchesLabel: weeks.error.message };
    const rows = (weeks.data ?? []) as { id: string; number: number; status: string; deadline_at: string | null }[];
    const now = Date.now();
    const playable = rows.find((week) => (
      (week.status === "open" || week.status === "scheduled")
      && week.deadline_at
      && new Date(week.deadline_at).getTime() > now
    ));
    const locked = rows.filter((week) => week.status === "locked");
    const latestScored = [...rows].reverse().find((week) => week.status === "scored" || week.status === "final");
    const open = playable ?? locked.at(-1) ?? latestScored ?? rows.at(-1);
    const behind = open
      ? rows.filter((week) => week.number < open.number && week.status !== "scored" && week.status !== "final")
      : [];
    if (!open) return { ...empty, label: `Serie A ${season.code}`, phase: "Nessuna giornata", behind: [] };
    const matches = await admin.from("real_matches").select("status, kickoff_at").eq("gameweek_id", open.id);
    const matchRows = matches.data ?? [];
    const kickoffs = matchRows
      .map((row) => String(row.kickoff_at ?? ""))
      .filter((value) => value)
      .sort();
    const labels: Record<string, string> = {
      scheduled: "in programma",
      live: "in corso",
      finished: "finite",
      postponed: "rinviate",
      suspended: "sospese",
    };
    const counts = matchRows.reduce<Record<string, number>>((bag, row) => {
      const status = labels[String(row.status ?? "")] ?? String(row.status ?? "sconosciuto");
      bag[status] = (bag[status] ?? 0) + 1;
      return bag;
    }, {});
    const parts = Object.entries(counts).map(([status, count]) => `${count} ${status}`);
    return {
      label: `Serie A ${season.code} · giornata ${open.number}`,
      phase: PHASE[String(open.status)] ?? String(open.status),
      deadlineAt: open.deadline_at ? String(open.deadline_at) : null,
      firstKickoffAt: kickoffs[0] ?? null,
      matchesLabel: matchRows.length === 0 ? "Nessuna partita collegata." : parts.join(" · "),
      behind: behind.map((week) => week.number),
    };
  } catch (error) {
    return { ...empty, matchesLabel: error instanceof Error ? error.message : "Lettura giornata non riuscita." };
  }
}

export async function readOpsDiagnostics(): Promise<OpsDiagnostics> {
  const [logs, settings, matchday] = await Promise.all([
    readSyncLogs(40),
    readSystemSettings(),
    currentMatchday(),
  ]);
  const jobs = JOBS.map((job) => latest(logs, job.jobType));
  const anomalies: string[] = [];
  if (!settings.ready) anomalies.push("Manca system_settings. Esegui supabase/system_settings.sql.");
  for (const job of jobs) {
    if (job.status === "error") anomalies.push(`${job.label}: ultimo giro in errore. ${job.message}`);
  }
  const votes = jobs[0];
  if (votes.status === "success" && votes.recordsWritten === 0 && await playedDayStillOpen().catch(() => false)) {
    anomalies.push("Voti: ultimo successo ha scritto 0 record e c'è ancora una giornata di ieri da calcolare.");
  }
  if (matchday.behind.length > 0) {
    anomalies.push(`Giornate precedenti ancora non calcolate: ${matchday.behind.join(", ")}.`);
  }
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) anomalies.push("Manca TELEGRAM_BOT_TOKEN nell'ambiente del server.");
  if (!process.env.TELEGRAM_CHAT_ID?.trim()) anomalies.push("Manca TELEGRAM_CHAT_ID nell'ambiente del server.");
  const admin = createAdminSupabase();
  const brand = await admin.from("system_settings").select("brand_logo_url, notify_on_sync_success").eq("id", 1).maybeSingle();
  if (brand.error && /brand_logo_url|notify_on_sync_success|schema cache|could not find|column/i.test(brand.error.message)) {
    anomalies.push("Mancano le colonne brand o il flag Telegram. Esegui supabase/brand_storage.sql.");
  }
  const tokens = await admin.from("device_push_tokens").select("id").limit(1);
  if (tokens.error && /schema cache|does not exist|could not find|relation/i.test(tokens.error.message)) {
    anomalies.push("Manca device_push_tokens. Esegui supabase/device_push_tokens.sql prima delle push native.");
  }
  return {
    jobs,
    logs,
    anomalies,
    matchday,
    telegramConfigured,
    notifyOnSyncSuccess: settings.notifyOnSyncSuccess,
  };
}
