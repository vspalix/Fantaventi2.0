import type { SupabaseClient } from "@supabase/supabase-js";

const OPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LATER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type WeekRow = {
  id: string;
  number: number;
  status: string;
  deadline_at: string;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export async function loadSeasonWeeks(admin: SupabaseClient, seasonId: string) {
  const { data, error } = await admin
    .from("gameweeks")
    .select("id, number, status, deadline_at")
    .eq("season_id", seasonId)
    .order("number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as WeekRow[];
}

export async function rosterAppliesFrom(admin: SupabaseClient, seasonId: string, now = Date.now()) {
  const weeks = await loadSeasonWeeks(admin, seasonId);
  const open = weeks.find((week) => week.status === "open");
  if (open) return open.number;
  const upcoming = weeks.find((week) => (
    (week.status === "scheduled" || week.status === "open")
    && new Date(week.deadline_at).getTime() > now
  ));
  if (upcoming) return upcoming.number;
  return weeks.find((week) => week.status === "scheduled")?.number ?? weeks[0]?.number ?? 1;
}

export async function activateSeasonGameweek(admin: SupabaseClient, seasonId: string, gameweekId: string, now = Date.now()) {
  const weeks = await loadSeasonWeeks(admin, seasonId);
  const target = weeks.find((week) => week.id === gameweekId);
  if (!target) throw httpError("Giornata non trovata in questa stagione.", 404);
  if (target.status === "scored" || target.status === "final") {
    throw httpError(`La giornata ${target.number} è già calcolata e resta chiusa.`, 409);
  }

  const earlier = weeks.find((week) => (
    week.number < target.number
    && (week.status === "scheduled" || week.status === "open")
    && new Date(week.deadline_at).getTime() > now
  ));
  if (earlier) {
    throw httpError(`Chiudi prima la giornata ${earlier.number}: è ancora quella su cui si schiera.`, 409);
  }

  const opened = await makeWeekPlayable(admin, weeks, target, now);
  return opened;
}

export async function openFollowingGameweek(admin: SupabaseClient, seasonId: string, closedNumber: number, now = Date.now()) {
  const weeks = await loadSeasonWeeks(admin, seasonId);
  const next = weeks.find((week) => week.number === closedNumber + 1);
  if (!next || next.status === "scored" || next.status === "final") return null;
  const opened = await makeWeekPlayable(admin, weeks, next, now);
  const { error } = await admin
    .from("lineups")
    .delete()
    .eq("gameweek_id", next.id)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  return opened;
}

async function makeWeekPlayable(admin: SupabaseClient, weeks: WeekRow[], target: WeekRow, now: number) {
  const deadline = new Date(now + OPEN_WINDOW_MS).toISOString();
  const laterDeadline = new Date(now + LATER_WINDOW_MS).toISOString();

  for (const week of weeks) {
    if (week.id === target.id) continue;
    const patch: { status?: "scheduled"; deadline_at?: string } = {};
    if (week.status === "open") patch.status = "scheduled";
    if (week.number > target.number && week.status !== "scored" && week.status !== "final") {
      const past = new Date(week.deadline_at).getTime() <= now;
      if (week.status === "locked" || past) {
        patch.status = "scheduled";
        patch.deadline_at = laterDeadline;
      }
    }
    if (!patch.status && !patch.deadline_at) continue;
    const { error } = await admin.from("gameweeks").update(patch).eq("id", week.id);
    if (error) throw new Error(error.message);
  }

  const { error } = await admin
    .from("gameweeks")
    .update({ status: "open", deadline_at: deadline })
    .eq("id", target.id);
  if (error) throw new Error(error.message);

  return {
    id: target.id,
    number: target.number,
    status: "open" as const,
    deadlineAt: deadline,
  };
}
