// Promemoria automatico delle formazioni: parte con la sveglia dei voti, una volta per squadra e giornata,
// solo a chi non ha ancora consegnato. Il «quando» è in lineup-reminder-plan.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/server/error-report";
import { loadSeasonWeeks } from "@/lib/server/gameweek-cycle";
import {
  clampLead,
  closingWords,
  DEFAULT_LEAD_MINUTES,
  lookAheadMinutes,
  MAX_LEAD_MINUTES,
  MIN_LEAD_MINUTES,
  reminderText,
  reminderVerdict,
} from "@/lib/server/lineup-reminder-plan";
import { readMaintenance } from "@/lib/server/maintenance";
import { loadWeekMatchState } from "@/lib/server/roster";
import { writeSyncLog } from "@/lib/server/system-settings";
import { alertLineupReminder } from "@/lib/server/telegram-alert";
import { sendPushToUsers, type PushPayload } from "@/lib/server/web-push";
import { createAdminSupabase } from "@/lib/supabase/admin";

const MINUTE = 60_000;
export const REMINDER_MIGRATION = "supabase/migrations/20261126180000_promemoria_formazioni.sql";

export type ReminderSettings = {
  enabled: boolean;
  leadMinutes: number;
  /** false finché la modifica al database non è stata eseguita. */
  ready: boolean;
};

export type ReminderWeek = { id: string; number: number; seasonId: string; status: string; deadlineAt: number };
export type PendingTeam = { teamId: string; userId: string };

export type ReminderDeps = {
  settings(): Promise<ReminderSettings>;
  maintenance(): Promise<boolean>;
  /** Giornate aperte alle formazioni con chiusura tra now e until. */
  upcomingWeeks(now: number, until: number): Promise<ReminderWeek[]>;
  /** Motivo per cui adesso non si può schierare su questa giornata, oppure null. */
  blocked(week: ReminderWeek, now: number): Promise<string | null>;
  pendingTeams(week: ReminderWeek): Promise<PendingTeam[]>;
  /** true solo la prima volta per quella chiave, anche con due chiamate insieme. */
  claim(key: string): Promise<boolean>;
  /** expiresAt: dopo la chiusura la notifica non va più consegnata (telefono spento o offline). */
  send(userIds: string[], payload: PushPayload, expiresAt: number, now: number): Promise<{ sent: number; people: number }>;
  record(summary: SentSummary, now: number): Promise<void>;
};

export type SentSummary = {
  gameweek: number;
  closing: string;
  teams: number;
  people: number;
  devices: number;
  late: boolean;
};

export type WeekOutcome =
  | { gameweek: number; state: "waiting"; moment: number }
  | { gameweek: number; state: "closed" }
  | { gameweek: number; state: "blocked"; reason: string }
  | { gameweek: number; state: "done"; teams: number; claimed: number; people: number; devices: number; late: boolean };

export type ReminderReport = { skipped: string | null; weeks: WeekOutcome[] };

export function reminderKey(weekId: string, teamId: string) {
  return `lineup-reminder:${weekId}:${teamId}`;
}

function missingTable(message: string) {
  return /system_settings|schema cache|could not find|does not exist/i.test(message);
}

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function settingsFromRow(row: Record<string, unknown> | null): ReminderSettings {
  if (!row || !("lineup_reminder_enabled" in row) || !("lineup_reminder_lead_minutes" in row)) {
    return { enabled: false, leadMinutes: DEFAULT_LEAD_MINUTES, ready: false };
  }
  return {
    enabled: row.lineup_reminder_enabled === true,
    leadMinutes: clampLead(Number(row.lineup_reminder_lead_minutes)),
    ready: true,
  };
}

export async function readReminderSettings(admin: SupabaseClient = createAdminSupabase()): Promise<ReminderSettings> {
  const row = await admin.from("system_settings").select("*").eq("id", 1).maybeSingle();
  if (row.error) {
    if (missingTable(row.error.message)) return settingsFromRow(null);
    throw new Error(row.error.message);
  }
  return settingsFromRow((row.data ?? null) as Record<string, unknown> | null);
}

export async function saveReminderSettings(input: { enabled: unknown; leadMinutes: unknown }, admin: SupabaseClient = createAdminSupabase()) {
  if (typeof input.enabled !== "boolean") throw httpError("Interruttore non valido.", 400);
  const lead = Number(input.leadMinutes);
  if (!Number.isInteger(lead) || lead < MIN_LEAD_MINUTES || lead > MAX_LEAD_MINUTES) {
    throw httpError(`L'anticipo va da ${MIN_LEAD_MINUTES} minuti a ${MAX_LEAD_MINUTES / 60} ore.`, 400);
  }
  const current = await readReminderSettings(admin);
  if (!current.ready) {
    throw httpError(`Prima va eseguita la modifica al database ${REMINDER_MIGRATION}.`, 409);
  }
  const saved = await admin
    .from("system_settings")
    .update({ lineup_reminder_enabled: input.enabled, lineup_reminder_lead_minutes: lead, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select("*")
    .maybeSingle();
  if (saved.error) throw new Error(saved.error.message);
  if (!saved.data) throw httpError("Impostazioni di sistema non trovate.", 404);
  return settingsFromRow(saved.data as Record<string, unknown>);
}

export async function runLineupReminder(now = Date.now(), deps: ReminderDeps = liveDeps()): Promise<ReminderReport> {
  const settings = await deps.settings();
  if (!settings.ready) return { skipped: "Manca la modifica al database.", weeks: [] };
  if (!settings.enabled) return { skipped: "Promemoria spento da Admin › Notifiche.", weeks: [] };

  const weeks = await deps.upcomingWeeks(now, now + lookAheadMinutes(settings.leadMinutes) * MINUTE);
  if (weeks.length === 0) return { skipped: null, weeks: [] };

  const outcomes: WeekOutcome[] = [];
  let maintenanceOn: boolean | null = null;
  for (const week of weeks) {
    const verdict = reminderVerdict(now, week.deadlineAt, settings.leadMinutes);
    if (!verdict.due) {
      outcomes.push(verdict.reason === "early"
        ? { gameweek: week.number, state: "waiting", moment: verdict.moment }
        : { gameweek: week.number, state: "closed" });
      continue;
    }
    // In manutenzione non si può salvare: si riprova alla sveglia dopo, se c'è ancora tempo.
    maintenanceOn ??= await deps.maintenance();
    if (maintenanceOn) {
      outcomes.push({ gameweek: week.number, state: "blocked", reason: "Manutenzione in corso." });
      continue;
    }
    const reason = await deps.blocked(week, now);
    if (reason) {
      outcomes.push({ gameweek: week.number, state: "blocked", reason });
      continue;
    }
    const pending = await deps.pendingTeams(week);
    const claimed: PendingTeam[] = [];
    for (const team of pending) {
      if (await deps.claim(reminderKey(week.id, team.teamId))) claimed.push(team);
    }
    let delivery = { sent: 0, people: 0 };
    if (claimed.length > 0) {
      const userIds = [...new Set(claimed.map((team) => team.userId))];
      delivery = await deps.send(userIds, reminderText(week.number, week.deadlineAt, now), week.deadlineAt, now);
      await deps.record({
        gameweek: week.number,
        closing: closingWords(week.deadlineAt, now),
        teams: claimed.length,
        people: delivery.people,
        devices: delivery.sent,
        late: verdict.late,
      }, now);
    }
    outcomes.push({
      gameweek: week.number,
      state: "done",
      teams: pending.length,
      claimed: claimed.length,
      people: delivery.people,
      devices: delivery.sent,
      late: verdict.late,
    });
  }
  return { skipped: null, weeks: outcomes };
}

/** Per la sveglia: non ferma mai la risposta e non nasconde gli errori. */
export async function runLineupReminderSafely(now = Date.now()) {
  try {
    return await runLineupReminder(now);
  } catch (error) {
    void reportError("Promemoria formazioni", error);
    return null;
  }
}

export function liveDeps(admin: SupabaseClient = createAdminSupabase(), send = sendPushToUsers): ReminderDeps {
  return {
    settings: () => readReminderSettings(admin),
    maintenance: async () => (await readMaintenance()).enabled,
    upcomingWeeks: (now, until) => upcomingWeeks(admin, now, until),
    blocked: (week, now) => blockedReason(admin, week, now),
    pendingTeams: (week) => pendingTeams(admin, week),
    claim: (key) => claimNotice(admin, key),
    send: async (userIds, payload, expiresAt, now) => {
      const result = await send(userIds, payload, admin, { ttlSeconds: (expiresAt - now) / 1000, urgent: true });
      return { sent: result.sent, people: result.people };
    },
    record: async (summary, now) => {
      await writeSyncLog({
        jobType: "reminders",
        triggerSource: "cron",
        status: "success",
        recordsWritten: summary.teams,
        message: `Promemoria giornata ${summary.gameweek} (chiude ${summary.closing}). Squadre senza formazione: ${summary.teams}. Persone raggiunte: ${summary.people}, dispositivi: ${summary.devices}.${summary.late ? " In ritardo per una sveglia persa." : ""}`,
      });
      await alertLineupReminder(summary, new Date(now));
    },
  };
}

async function upcomingWeeks(admin: SupabaseClient, now: number, until: number): Promise<ReminderWeek[]> {
  const rows = await admin
    .from("gameweeks")
    .select("id, number, season_id, status, deadline_at")
    .in("status", ["scheduled", "open"])
    .gt("deadline_at", new Date(now).toISOString())
    .lte("deadline_at", new Date(until).toISOString())
    .order("number", { ascending: true });
  if (rows.error) throw new Error(rows.error.message);
  // Una sola giornata per stagione: quella su cui si schiera adesso.
  const bySeason = new Map<string, ReminderWeek>();
  for (const row of rows.data ?? []) {
    const seasonId = row.season_id as string;
    if (bySeason.has(seasonId)) continue;
    bySeason.set(seasonId, {
      id: row.id as string,
      number: Number(row.number),
      seasonId,
      status: row.status as string,
      deadlineAt: new Date(row.deadline_at as string).getTime(),
    });
  }
  return [...bySeason.values()];
}

/** Stesse regole della schermata di lega: si schiera solo sulla prima giornata non chiusa, a partite ferme. */
async function blockedReason(admin: SupabaseClient, week: ReminderWeek, now: number) {
  const weeks = await loadSeasonWeeks(admin, week.seasonId);
  const earlierOpen = weeks.find((row) => (
    row.number < week.number
    && (row.status === "scheduled" || row.status === "open")
    && new Date(row.deadline_at).getTime() > now
  ));
  if (earlierOpen) return `Prima si schiera la giornata ${earlierOpen.number}.`;
  const state = await loadWeekMatchState(admin, week.seasonId, now);
  if (state.inPlay.has(week.number)) return "Una partita della giornata è già iniziata.";
  const underway = weeks.find((row) => (
    row.number < week.number
    && row.status !== "scored"
    && row.status !== "final"
    && (state.inPlay.has(row.number) || new Date(row.deadline_at).getTime() <= now)
    && state.withMatches.has(row.number)
    && !state.finished.has(row.number)
  ));
  if (underway) return `La giornata ${underway.number} è ancora in corso.`;
  return null;
}

async function pendingTeams(admin: SupabaseClient, week: ReminderWeek): Promise<PendingTeam[]> {
  const leagues = await admin
    .from("private_leagues")
    .select("id, start_matchday, end_matchday, is_sandbox")
    .eq("season_id", week.seasonId);
  if (leagues.error) throw new Error(leagues.error.message);
  // Le leghe di prova restano fuori; contano solo quelle che giocano questa giornata.
  const leagueIds = (leagues.data ?? [])
    .filter((row) => row.is_sandbox !== true)
    .filter((row) => Number(row.start_matchday ?? 1) <= week.number && Number(row.end_matchday ?? 38) >= week.number)
    .map((row) => row.id as string);
  if (leagueIds.length === 0) return [];
  const members = await admin.from("private_league_members").select("fantasy_team_id").in("private_league_id", leagueIds);
  if (members.error) throw new Error(members.error.message);
  const teamIds = [...new Set((members.data ?? []).map((row) => row.fantasy_team_id as string))];
  if (teamIds.length === 0) return [];
  const teams = await admin.from("fantasy_teams").select("id, user_id").in("id", teamIds);
  if (teams.error) throw new Error(teams.error.message);
  const filed = await admin.from("lineups").select("fantasy_team_id").eq("gameweek_id", week.id).in("fantasy_team_id", teamIds);
  if (filed.error) throw new Error(filed.error.message);
  const ready = new Set((filed.data ?? []).map((row) => row.fantasy_team_id as string));
  return (teams.data ?? [])
    .filter((row) => row.user_id && !ready.has(row.id as string))
    .map((row) => ({ teamId: row.id as string, userId: row.user_id as string }));
}

async function claimNotice(admin: SupabaseClient, key: string) {
  const inserted = await admin.from("engagement_notices").insert({ dedupe_key: key });
  if (!inserted.error) return true;
  if (inserted.error.code === "23505" || /duplicate/i.test(inserted.error.message)) return false;
  throw new Error(inserted.error.message);
}

export type ReminderPreview = {
  settings: ReminderSettings;
  next: {
    gameweek: number;
    deadlineAt: string;
    momentAt: string;
    /** Il momento previsto è già passato: parte alla prossima sveglia, se c'è ancora tempo. */
    overdue: boolean;
    pending: number | null;
    /** Squadre che hanno già ricevuto il promemoria di questa giornata. */
    reminded: number;
    blocked: string | null;
  } | null;
};

/** Per il Laboratorio: la prossima giornata e quando partirà il promemoria. Solo letture. */
export async function previewLineupReminder(now = Date.now(), admin: SupabaseClient = createAdminSupabase()): Promise<ReminderPreview> {
  const settings = await readReminderSettings(admin);
  const weeks = await upcomingWeeks(admin, now, now + 30 * 24 * 60 * MINUTE);
  const week = weeks.sort((left, right) => left.deadlineAt - right.deadlineAt)[0];
  if (!week) return { settings, next: null };
  const verdict = reminderVerdict(now, week.deadlineAt, settings.leadMinutes);
  const blocked = await blockedReason(admin, week, now);
  const pending = blocked ? null : (await pendingTeams(admin, week)).length;
  const notices = await admin
    .from("engagement_notices")
    .select("dedupe_key")
    .like("dedupe_key", `${reminderKey(week.id, "")}%`);
  if (notices.error) throw new Error(notices.error.message);
  return {
    settings,
    next: {
      gameweek: week.number,
      deadlineAt: new Date(week.deadlineAt).toISOString(),
      momentAt: new Date(verdict.moment).toISOString(),
      overdue: verdict.due,
      pending,
      reminded: (notices.data ?? []).length,
      blocked,
    },
  };
}
