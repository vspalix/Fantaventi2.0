import { createAdminSupabase } from "@/lib/supabase/admin";

export const DEFAULT_VOTES_SOURCE_URL = "https://www.fantacalcio.it/serie-a/voti";

export type SystemSettings = {
  votesSourceUrl: string;
  votesProvider: string;
  availabilityProvider: string;
  apiSportsLeagueId: number;
  apiSportsSeason: number;
  syncWindowPostMatchMin: number;
  syncWindowPostMatchMax: number;
  syncWindowEveningStart: string;
  syncWindowEveningEnd: string;
  syncWindowMorningStart: string;
  syncWindowMorningEnd: string;
  autoSyncEnabled: boolean;
  notifyOnSyncSuccess: boolean;
  halftimeReadEnabled: boolean;
  ready: boolean;
};

export type SyncLogEntry = {
  jobType: "votes" | "availability" | "kickoffs";
  triggerSource: "cron" | "manual";
  status: "success" | "skipped" | "error";
  recordsWritten: number;
  message: string;
};

const DEFAULTS: SystemSettings = {
  votesSourceUrl: DEFAULT_VOTES_SOURCE_URL,
  votesProvider: "fantacalcio",
  availabilityProvider: "api-sports",
  apiSportsLeagueId: 135,
  apiSportsSeason: 2026,
  syncWindowPostMatchMin: 125,
  syncWindowPostMatchMax: 150,
  syncWindowEveningStart: "23:15",
  syncWindowEveningEnd: "23:45",
  syncWindowMorningStart: "09:15",
  syncWindowMorningEnd: "09:45",
  autoSyncEnabled: true,
  notifyOnSyncSuccess: true,
  halftimeReadEnabled: true,
  ready: false,
};

function missing(message: string) {
  return /system_settings|sync_logs|schema cache|could not find|does not exist/i.test(message);
}

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clockOr(value: unknown, fallback: string) {
  return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim()) ? value.trim().padStart(5, "0") : fallback;
}

function normalize(row: Record<string, unknown>): SystemSettings {
  const min = numberOr(row.sync_window_post_match_min, DEFAULTS.syncWindowPostMatchMin);
  const max = numberOr(row.sync_window_post_match_max, DEFAULTS.syncWindowPostMatchMax);
  return {
    votesSourceUrl: typeof row.votes_source_url === "string" && row.votes_source_url.trim()
      ? row.votes_source_url.trim().replace(/\/$/, "")
      : DEFAULTS.votesSourceUrl,
    votesProvider: typeof row.votes_provider === "string" && row.votes_provider.trim()
      ? row.votes_provider.trim()
      : DEFAULTS.votesProvider,
    availabilityProvider: typeof row.availability_provider === "string" && row.availability_provider.trim()
      ? row.availability_provider.trim()
      : DEFAULTS.availabilityProvider,
    apiSportsLeagueId: numberOr(row.api_sports_league_id, DEFAULTS.apiSportsLeagueId),
    apiSportsSeason: numberOr(row.api_sports_season, DEFAULTS.apiSportsSeason),
    syncWindowPostMatchMin: min <= max ? min : DEFAULTS.syncWindowPostMatchMin,
    syncWindowPostMatchMax: min <= max ? max : DEFAULTS.syncWindowPostMatchMax,
    syncWindowEveningStart: clockOr(row.sync_window_evening_start, DEFAULTS.syncWindowEveningStart),
    syncWindowEveningEnd: clockOr(row.sync_window_evening_end, DEFAULTS.syncWindowEveningEnd),
    syncWindowMorningStart: clockOr(row.sync_window_morning_start, DEFAULTS.syncWindowMorningStart),
    syncWindowMorningEnd: clockOr(row.sync_window_morning_end, DEFAULTS.syncWindowMorningEnd),
    autoSyncEnabled: typeof row.auto_sync_enabled === "boolean" ? row.auto_sync_enabled : DEFAULTS.autoSyncEnabled,
    notifyOnSyncSuccess: typeof row.notify_on_sync_success === "boolean" ? row.notify_on_sync_success : DEFAULTS.notifyOnSyncSuccess,
    halftimeReadEnabled: typeof row.halftime_read_enabled === "boolean" ? row.halftime_read_enabled : DEFAULTS.halftimeReadEnabled,
    ready: true,
  };
}

export async function readSystemSettings(): Promise<SystemSettings> {
  try {
    const admin = createAdminSupabase();
    const row = await admin.from("system_settings").select("*").eq("id", 1).maybeSingle();
    if (row.error) {
      if (missing(row.error.message)) return DEFAULTS;
      throw new Error(row.error.message);
    }
    if (!row.data) return { ...DEFAULTS, ready: true };
    return normalize(row.data as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (missing(message)) return DEFAULTS;
    throw error;
  }
}

export function clockMinutes(value: string, fallback: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

export type SyncLogRow = {
  id: string;
  createdAt: string;
  jobType: "votes" | "availability" | "kickoffs";
  triggerSource: "cron" | "manual";
  status: "success" | "skipped" | "error";
  recordsWritten: number;
  message: string;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function clockValue(value: string, label: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw httpError(`${label} va scritto come 23:15.`, 400);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw httpError(`${label} non è un orario valido.`, 400);
  return match[0];
}

export async function saveSystemSettings(input: Omit<SystemSettings, "ready">) {
  const current = await readSystemSettings();
  if (!current.ready) throw httpError("Manca la tabella. Esegui supabase/system_settings.sql nell'editor SQL.", 503);
  const provider = input.votesProvider === "custom" ? "custom" : "fantacalcio";
  const url = input.votesSourceUrl.trim().replace(/\/$/, "");
  if (!/^https:\/\/\S+$/i.test(url)) throw httpError("L'URL dei voti deve iniziare con https://.", 400);
  const postMin = Math.trunc(Number(input.syncWindowPostMatchMin));
  const postMax = Math.trunc(Number(input.syncWindowPostMatchMax));
  if (!Number.isInteger(postMin) || !Number.isInteger(postMax) || postMin < 0 || postMax > 400 || postMin > postMax) {
    throw httpError("La finestra post-partita deve avere un minimo minore o uguale al massimo.", 400);
  }
  const eveningStart = clockValue(input.syncWindowEveningStart, "L'inizio serale");
  const eveningEnd = clockValue(input.syncWindowEveningEnd, "La fine serale");
  const morningStart = clockValue(input.syncWindowMorningStart, "L'inizio mattutino");
  const morningEnd = clockValue(input.syncWindowMorningEnd, "La fine mattutina");
  if (eveningStart > eveningEnd || morningStart > morningEnd) throw httpError("Ogni fascia deve finire dopo l'inizio.", 400);
  const leagueId = Math.trunc(Number(input.apiSportsLeagueId));
  const season = Math.trunc(Number(input.apiSportsSeason));
  if (!Number.isInteger(leagueId) || leagueId < 1 || !Number.isInteger(season) || season < 2000 || season > 2100) {
    throw httpError("League ID e stagione non sono validi.", 400);
  }
  const admin = createAdminSupabase();
  const saved = await admin.from("system_settings").upsert({
    id: 1,
    votes_source_url: url,
    votes_provider: provider,
    availability_provider: current.availabilityProvider,
    api_sports_league_id: leagueId,
    api_sports_season: season,
    sync_window_post_match_min: postMin,
    sync_window_post_match_max: postMax,
    sync_window_evening_start: eveningStart,
    sync_window_evening_end: eveningEnd,
    sync_window_morning_start: morningStart,
    sync_window_morning_end: morningEnd,
    auto_sync_enabled: input.autoSyncEnabled,
    updated_at: new Date().toISOString(),
  });
  if (saved.error) {
    if (missing(saved.error.message)) throw httpError("Manca la tabella. Esegui supabase/system_settings.sql nell'editor SQL.", 503);
    throw new Error(saved.error.message);
  }
  const flagged = await admin.from("system_settings").update({
    notify_on_sync_success: input.notifyOnSyncSuccess,
  }).eq("id", 1);
  const flagMissing = Boolean(flagged.error && /notify_on_sync_success|schema cache|could not find|column/i.test(flagged.error.message));
  if (flagged.error && !flagMissing) throw new Error(flagged.error.message);
  const halftime = await admin.from("system_settings").update({
    halftime_read_enabled: input.halftimeReadEnabled,
  }).eq("id", 1);
  const halftimeMissing = Boolean(halftime.error && /halftime_read_enabled|schema cache|could not find|column/i.test(halftime.error.message));
  if (halftime.error && !halftimeMissing) throw new Error(halftime.error.message);
  return {
    settings: normalize({
    votes_source_url: url,
    votes_provider: provider,
    availability_provider: current.availabilityProvider,
    api_sports_league_id: leagueId,
    api_sports_season: season,
    sync_window_post_match_min: postMin,
    sync_window_post_match_max: postMax,
    sync_window_evening_start: eveningStart,
    sync_window_evening_end: eveningEnd,
    sync_window_morning_start: morningStart,
    sync_window_morning_end: morningEnd,
    auto_sync_enabled: input.autoSyncEnabled,
    notify_on_sync_success: flagMissing ? current.notifyOnSyncSuccess : input.notifyOnSyncSuccess,
    halftime_read_enabled: halftimeMissing ? current.halftimeReadEnabled : input.halftimeReadEnabled,
  }),
    notice: halftimeMissing
      ? "L'interruttore dell'intervallo non è ancora in tabella. Esegui supabase/vote_schedule.sql."
      : flagMissing ? "Il flag Telegram non è ancora in tabella. Esegui supabase/brand_storage.sql." : null,
  };
}

export async function readSyncLogs(limit = 20): Promise<SyncLogRow[]> {
  const admin = createAdminSupabase();
  const rows = await admin
    .from("sync_logs")
    .select("id, created_at, job_type, trigger_source, status, records_written, message")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (rows.error) {
    if (missing(rows.error.message)) return [];
    throw new Error(rows.error.message);
  }
  return (rows.data ?? []).map((row) => ({
    id: String(row.id),
    createdAt: String(row.created_at),
    jobType: row.job_type === "availability" ? "availability" : row.job_type === "kickoffs" ? "kickoffs" : "votes",
    triggerSource: row.trigger_source === "manual" ? "manual" : "cron",
    status: row.status === "success" || row.status === "error" ? row.status : "skipped",
    recordsWritten: Number(row.records_written) || 0,
    message: String(row.message ?? ""),
  }));
}

export async function writeSyncLog(entry: SyncLogEntry) {
  try {
    const admin = createAdminSupabase();
    const saved = await admin.from("sync_logs").insert({
      job_type: entry.jobType,
      trigger_source: entry.triggerSource,
      status: entry.status,
      records_written: entry.recordsWritten,
      message: entry.message.slice(0, 500),
    });
    if (saved.error && !missing(saved.error.message) && !/job_type|check constraint/i.test(saved.error.message)) {
      console.error(saved.error.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!missing(message)) console.error(message);
  }
}
