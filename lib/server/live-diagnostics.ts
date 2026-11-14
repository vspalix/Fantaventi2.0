import { getCurrentSeason } from "@/lib/server/catalog";
import { refreshSerieAKickoffs } from "@/lib/server/kickoff-refresh";
import { scoreOfficialGameweek } from "@/lib/server/live-score";
import { missingSandboxColumn } from "@/lib/server/sandbox-flag";
import { syncDueMatchVotes } from "@/lib/server/sync-match-votes";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type LiveDiagnostics = {
  seasonCode: string;
  calendar: {
    at: string | null;
    appliedAt: string | null;
    status: string | null;
    provider: string | null;
    error: string | null;
  };
  votes: {
    at: string | null;
    gameweekNumber: number | null;
    source: string | null;
    imported: number;
    error: string | null;
  };
  leagues: { id: string; name: string }[];
  filing: {
    leagueName: string;
    gameweekNumber: number | null;
    filed: number;
    teams: number;
    locked: boolean;
    deadlineAt: string | null;
  } | null;
};

function payloadError(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : null;
}

export async function readLiveDiagnostics(leagueId?: string | null): Promise<LiveDiagnostics> {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const calendar = await admin
    .from("calendar_sync_runs")
    .select("created_at, applied_at, status, provider, payload")
    .eq("season_id", season.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const calendarRow = calendar.error ? null : calendar.data?.[0];

  const weeks = await admin
    .from("gameweeks")
    .select("id, number, status, deadline_at")
    .eq("season_id", season.id)
    .order("number");
  if (weeks.error) throw new Error(weeks.error.message);
  const weekRows = weeks.data ?? [];
  const weekIds = weekRows.map((row) => row.id as string);
  const imports = weekIds.length === 0
    ? { data: [], error: null }
    : await admin
      .from("vote_imports")
      .select("id, gameweek_id, source, imported_at")
      .in("gameweek_id", weekIds)
      .order("imported_at", { ascending: false })
      .limit(1);
  const importRow = imports.error ? null : imports.data?.[0];
  let imported = 0;
  if (importRow) {
    const stats = await admin
      .from("player_gameweek_stats")
      .select("id", { count: "exact", head: true })
      .eq("vote_import_id", importRow.id as string);
    imported = stats.count ?? 0;
  }
  const numberById = new Map(weekRows.map((row) => [row.id as string, row.number as number]));

  const flagged = await admin
    .from("private_leagues")
    .select("id, name")
    .eq("season_id", season.id)
    .eq("is_sandbox", false)
    .order("name");
  const leagueQuery = flagged.error && missingSandboxColumn(flagged.error.message)
    ? await admin.from("private_leagues").select("id, name").eq("season_id", season.id).order("name")
    : flagged;
  if (leagueQuery.error) throw new Error(leagueQuery.error.message);
  const leagues = (leagueQuery.data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
  const selected = leagues.find((league) => league.id === leagueId) ?? leagues[0] ?? null;

  return {
    seasonCode: season.code,
    calendar: {
      at: (calendarRow?.created_at as string | undefined) ?? null,
      appliedAt: (calendarRow?.applied_at as string | undefined) ?? null,
      status: (calendarRow?.status as string | undefined) ?? null,
      provider: (calendarRow?.provider as string | undefined) ?? null,
      error: calendar.error?.message ?? payloadError(calendarRow?.payload),
    },
    votes: {
      at: (importRow?.imported_at as string | undefined) ?? null,
      gameweekNumber: importRow ? numberById.get(importRow.gameweek_id as string) ?? null : null,
      source: (importRow?.source as string | undefined) ?? null,
      imported,
      error: imports.error?.message ?? null,
    },
    leagues,
    filing: selected ? await filingFor(selected, weekRows) : null,
  };
}

function pickCurrent<T extends { number: number; status: string }>(weeks: T[]): T | null {
  const lastClosed = weeks.reduce((max, week) => (
    week.status === "scored" || week.status === "final" ? Math.max(max, Number(week.number)) : max
  ), 0);
  return weeks.find((week) => Number(week.number) > lastClosed) ?? weeks.at(-1) ?? null;
}

async function filingFor(
  league: { id: string; name: string },
  weeks: { id: string; number: number; status: string; deadline_at: string }[],
) {
  const admin = createAdminSupabase();
  const now = Date.now();
  const current = pickCurrent(weeks);
  const members = await admin.from("private_league_members").select("fantasy_team_id").eq("private_league_id", league.id);
  if (members.error) throw new Error(members.error.message);
  const teamIds = (members.data ?? []).map((row) => row.fantasy_team_id as string);
  let filed = 0;
  if (current && teamIds.length > 0) {
    const lineups = await admin
      .from("lineups")
      .select("fantasy_team_id", { count: "exact", head: true })
      .eq("gameweek_id", current.id)
      .in("fantasy_team_id", teamIds);
    filed = lineups.count ?? 0;
  }
  const locked = Boolean(current && (
    current.status === "locked"
    || current.status === "scored"
    || current.status === "final"
    || new Date(current.deadline_at).getTime() <= now
  ));
  return {
    leagueName: league.name,
    gameweekNumber: current?.number ?? null,
    filed,
    teams: teamIds.length,
    locked,
    deadlineAt: current?.deadline_at ?? null,
  };
}

export async function forceLiveRound() {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  let calendar: Awaited<ReturnType<typeof refreshSerieAKickoffs>> | null = null;
  let calendarError: string | null = null;
  try {
    calendar = await refreshSerieAKickoffs({ force: true, seasonId: season.id });
  } catch (error) {
    calendarError = error instanceof Error ? error.message : "Sincronismo calendario non riuscito.";
  }
  const votes = await syncDueMatchVotes();
  const weeks = await admin
    .from("gameweeks")
    .select("id, number, status, deadline_at")
    .eq("season_id", season.id)
    .order("number");
  if (weeks.error) throw new Error(weeks.error.message);
  const rows = (weeks.data ?? []) as { id: string; number: number; status: string; deadline_at: string }[];
  const current = pickCurrent(rows);
  const score = current
    ? await scoreOfficialGameweek(current.id, { allowRewrite: current.status === "scored" })
    : null;
  return {
    seasonCode: season.code,
    calendar,
    calendarError,
    votes,
    gameweekNumber: current ? Number(current.number) : null,
    score,
  };
}
