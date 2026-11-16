import { createAdminSupabase } from "@/lib/supabase/admin";

export const VOTE_SYNC_SKIP_REASON = "Outside surgical sync windows";

const FRESH_MIN_MS = 125 * 60 * 1000;
const FRESH_MAX_MS = 150 * 60 * 1000;
const MORNING_START = 9 * 60 + 15;
const MORNING_END = 9 * 60 + 45;
const EVENING_START = 23 * 60 + 15;
const EVENING_END = 23 * 60 + 45;

export type VoteWindow = {
  open: boolean;
  fresh: boolean;
  evening: boolean;
  morning: boolean;
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

export function voteWindowForMatches(now: Date, matches: WindowMatch[]): VoteWindow {
  const clock = romeClock(now);
  const yesterday = shiftRomeDate(clock.date, -1);
  const fresh = matches.some((match) => {
    const kickoff = new Date(match.kickoffAt).getTime();
    if (!Number.isFinite(kickoff) || match.votesFetched) return false;
    const age = now.getTime() - kickoff;
    return age >= FRESH_MIN_MS && age <= FRESH_MAX_MS;
  });
  const playedToday = matches.some((match) => romeDate(match.kickoffAt) === clock.date);
  const playedYesterday = matches.some((match) => romeDate(match.kickoffAt) === yesterday);
  const evening = clock.minutes >= EVENING_START && clock.minutes <= EVENING_END && playedToday;
  const morning = clock.minutes >= MORNING_START && clock.minutes <= MORNING_END && playedYesterday;
  return { open: fresh || evening || morning, fresh, evening, morning, date: clock.date };
}

export async function inspectVoteSyncWindow(now = new Date()): Promise<VoteWindow> {
  const closed: VoteWindow = { open: false, fresh: false, evening: false, morning: false, date: romeClock(now).date };
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
  })));
}
