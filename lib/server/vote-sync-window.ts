import { createAdminSupabase } from "@/lib/supabase/admin";
import { clockMinutes, readSystemSettings } from "@/lib/server/system-settings";

export const VOTE_SYNC_SKIP_REASON = "Outside surgical sync windows";

const FRESH_MIN_MS = 125 * 60 * 1000;
const FRESH_MAX_MS = 150 * 60 * 1000;
const MORNING_START = 9 * 60 + 15;
const MORNING_END = 9 * 60 + 45;
const EVENING_START = 23 * 60 + 15;
const EVENING_END = 23 * 60 + 45;

export type VoteWindowBounds = {
  freshMinMs: number;
  freshMaxMs: number;
  morningStart: number;
  morningEnd: number;
  eveningStart: number;
  eveningEnd: number;
};

const DEFAULT_BOUNDS: VoteWindowBounds = {
  freshMinMs: FRESH_MIN_MS,
  freshMaxMs: FRESH_MAX_MS,
  morningStart: MORNING_START,
  morningEnd: MORNING_END,
  eveningStart: EVENING_START,
  eveningEnd: EVENING_END,
};

export type VoteWindow = {
  open: boolean;
  fresh: boolean;
  evening: boolean;
  morning: boolean;
  closing: boolean;
  date: string;
};

type WindowMatch = {
  kickoffAt: string;
  votesFetched: boolean;
};

export function romeClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(read("hour"));
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: (hour === 24 ? 0 : hour) * 60 + Number(read("minute")),
  };
}

export function shiftRomeDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function romeDate(kickoffAt: string) {
  const time = new Date(kickoffAt).getTime();
  if (!Number.isFinite(time)) return "";
  return romeClock(new Date(time)).date;
}

export function voteWindowForMatches(now: Date, matches: WindowMatch[], bounds: VoteWindowBounds = DEFAULT_BOUNDS): VoteWindow {
  const clock = romeClock(now);
  const yesterday = shiftRomeDate(clock.date, -1);
  const fresh = matches.some((match) => {
    const kickoff = new Date(match.kickoffAt).getTime();
    if (!Number.isFinite(kickoff) || match.votesFetched) return false;
    const age = now.getTime() - kickoff;
    return age >= bounds.freshMinMs && age <= bounds.freshMaxMs;
  });
  const playedToday = matches.some((match) => romeDate(match.kickoffAt) === clock.date);
  const playedYesterday = matches.some((match) => romeDate(match.kickoffAt) === yesterday);
  const evening = clock.minutes >= bounds.eveningStart && clock.minutes <= bounds.eveningEnd && playedToday;
  const morning = clock.minutes >= bounds.morningStart && clock.minutes <= bounds.morningEnd && playedYesterday;
  const closing = morning && bounds.morningEnd - clock.minutes < 15;
  return { open: fresh || evening || morning, fresh, evening, morning, closing, date: clock.date };
}

async function windowBounds(): Promise<VoteWindowBounds> {
  const settings = await readSystemSettings();
  return {
    freshMinMs: settings.syncWindowPostMatchMin * 60 * 1000,
    freshMaxMs: settings.syncWindowPostMatchMax * 60 * 1000,
    morningStart: clockMinutes(settings.syncWindowMorningStart, MORNING_START),
    morningEnd: clockMinutes(settings.syncWindowMorningEnd, MORNING_END),
    eveningStart: clockMinutes(settings.syncWindowEveningStart, EVENING_START),
    eveningEnd: clockMinutes(settings.syncWindowEveningEnd, EVENING_END),
  };
}

export async function inspectVoteSyncWindow(now = new Date()): Promise<VoteWindow> {
  const closed: VoteWindow = { open: false, fresh: false, evening: false, morning: false, closing: false, date: romeClock(now).date };
  const bounds = await windowBounds();
  const admin = createAdminSupabase();
  const seasons = await admin.from("seasons").select("id, competitions!inner(code)");
  if (seasons.error) throw new Error(seasons.error.message);
  const seasonIds = (seasons.data ?? []).flatMap((season) => {
    const competition = Array.isArray(season.competitions) ? season.competitions[0] : season.competitions;
    return competition?.code === "serie_a" ? [season.id as string] : [];
  });
  if (seasonIds.length === 0) return closed;
  const weeks = await admin.from("gameweeks").select("id").in("season_id", seasonIds).neq("status", "final");
  if (weeks.error) throw new Error(weeks.error.message);
  const weekIds = (weeks.data ?? []).map((week) => week.id as string);
  if (weekIds.length === 0) return closed;
  const matches = await admin.from("real_matches").select("kickoff_at, status").in("gameweek_id", weekIds);
  if (matches.error) throw new Error(matches.error.message);
  return voteWindowForMatches(now, (matches.data ?? []).map((match) => ({
    kickoffAt: String(match.kickoff_at),
    votesFetched: match.status === "finished",
  })), bounds);
}

export async function playedDayStillOpen(now = new Date()) {
  const yesterday = shiftRomeDate(romeClock(now).date, -1);
  const admin = createAdminSupabase();
  const seasons = await admin.from("seasons").select("id, competitions!inner(code)");
  if (seasons.error) throw new Error(seasons.error.message);
  const seasonIds = (seasons.data ?? []).flatMap((season) => {
    const competition = Array.isArray(season.competitions) ? season.competitions[0] : season.competitions;
    return competition?.code === "serie_a" ? [season.id as string] : [];
  });
  if (seasonIds.length === 0) return false;
  const weeks = await admin.from("gameweeks").select("id, status").in("season_id", seasonIds);
  if (weeks.error) throw new Error(weeks.error.message);
  const openIds = (weeks.data ?? [])
    .filter((week) => week.status !== "scored" && week.status !== "final")
    .map((week) => week.id as string);
  if (openIds.length === 0) return false;
  const matches = await admin.from("real_matches").select("kickoff_at").in("gameweek_id", openIds);
  if (matches.error) throw new Error(matches.error.message);
  return (matches.data ?? []).some((match) => romeDate(String(match.kickoff_at)) === yesterday);
}
