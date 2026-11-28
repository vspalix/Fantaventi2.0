import { cache } from "react";
import { cookies } from "next/headers";
import { ACTION_LABEL } from "@/lib/admin-audit-labels";
import { listAdminAudit } from "@/lib/server/audit";
import { getCurrentSeason } from "@/lib/server/catalog";
import { reportIfTechnical } from "@/lib/server/error-report";
import { PROVISIONAL_SOURCE } from "@/lib/server/provisional-votes";
import { leagueTeamIds } from "@/lib/server/league-members";
import { readAllChunks, readAllRows } from "@/lib/server/read-all";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ADMIN_LEAGUE_COOKIE } from "@/lib/admin-area";

// Dati dell'area superadmin: solo letture, nessuna scrittura nel database.

type Week = { id: string; number: number; status: string; deadline_at: string };

export type AdminLeague = {
  id: string;
  name: string;
  sandbox: boolean;
  teams: number;
  filed: number;
};

export type AdminLeagues = {
  seasonCode: string;
  week: Week | null;
  leagues: AdminLeague[];
  /** Formazioni chiuse: dopo la scadenza chi manca non può più consegnare. */
  locked: boolean;
};

const DAY = 24 * 60 * 60 * 1000;
/** Fermo di sicurezza per l'elenco degli accessi: 200.000 persone. */
const MAX_USER_PAGES = 1000;

function pickCurrent(weeks: Week[]): Week | null {
  const lastClosed = weeks.reduce((max, week) => (
    week.status === "scored" || week.status === "final" ? Math.max(max, Number(week.number)) : max
  ), 0);
  return weeks.find((week) => Number(week.number) > lastClosed) ?? weeks.at(-1) ?? null;
}

/** Lega scelta nel selettore; null vuol dire «Tutte le leghe». */
export async function readAdminLeagueId(): Promise<string | null> {
  try {
    const value = (await cookies()).get(ADMIN_LEAGUE_COOKIE)?.value ?? "";
    return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Leghe della stagione con le formazioni consegnate nella giornata corrente. */
export const loadAdminLeagues = cache(async (): Promise<AdminLeagues> => {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const weeks = await admin
    .from("gameweeks")
    .select("id, number, status, deadline_at")
    .eq("season_id", season.id)
    .order("number");
  if (weeks.error) throw new Error(weeks.error.message);
  const week = pickCurrent((weeks.data ?? []) as Week[]);

  const read = (columns: string) => readAllRows<{ id: string; name: string; is_sandbox?: boolean }>((from, to) => admin
    .from("private_leagues")
    .select(columns)
    .eq("season_id", season.id)
    .order("name")
    .order("id")
    .range(from, to)
    .returns<{ id: string; name: string; is_sandbox?: boolean }[]>());
  let listed = await read("id, name, is_sandbox");
  if (listed.error && /is_sandbox/i.test(listed.error.message)) listed = await read("id, name");
  if (listed.error) throw new Error(listed.error.message);
  const rows = listed.data;

  const teamsByLeague = new Map<string, string[]>();
  const filedTeams = new Set<string>();
  if (rows.length > 0) {
    const members = await readAllChunks(rows.map((row) => row.id), (ids, from, to) => admin
      .from("private_league_members")
      .select("private_league_id, fantasy_team_id")
      .in("private_league_id", ids)
      .order("private_league_id")
      .order("fantasy_team_id")
      .range(from, to));
    if (members.error) throw new Error(members.error.message);
    for (const row of members.data) {
      const list = teamsByLeague.get(row.private_league_id as string) ?? [];
      list.push(row.fantasy_team_id as string);
      teamsByLeague.set(row.private_league_id as string, list);
    }
    if (week && teamsByLeague.size > 0) {
      const lineups = await readAllRows((from, to) => admin
        .from("lineups")
        .select("fantasy_team_id")
        .eq("gameweek_id", week.id)
        .order("id")
        .range(from, to));
      if (lineups.error) throw new Error(lineups.error.message);
      for (const row of lineups.data) filedTeams.add(row.fantasy_team_id as string);
    }
  }

  const locked = Boolean(week && (
    ["locked", "scored", "final"].includes(week.status) || new Date(week.deadline_at).getTime() <= Date.now()
  ));
  return {
    seasonCode: season.code,
    week,
    locked,
    leagues: rows.map((row) => {
      const teams = teamsByLeague.get(row.id) ?? [];
      return {
        id: row.id,
        name: row.name,
        sandbox: Boolean(row.is_sandbox),
        teams: teams.length,
        filed: teams.filter((team) => filedTeams.has(team)).length,
      };
    }),
  };
});

/** Leghe della stagione e lega scelta nel selettore (null = «Tutte le leghe»). */
export async function resolveAdminLeague() {
  const [data, id] = await Promise.all([loadAdminLeagues(), readAdminLeagueId()]);
  return { data, selected: data.leagues.find((league) => league.id === id) ?? null };
}

export type TeamLineup ={ id: string; name: string; filed: boolean; savedAt: string | null };

/** Squadre di una lega e stato della formazione nella giornata corrente. */
export async function loadLeagueLineups(leagueId: string, weekId: string | null): Promise<TeamLineup[]> {
  const admin = createAdminSupabase();
  const ids = await leagueTeamIds(admin, leagueId);
  if (ids.length === 0) return [];
  const teams = await readAllChunks(ids, (part, from, to) => admin.from("fantasy_teams").select("id, name").in("id", part).order("id").range(from, to));
  if (teams.error) throw new Error(teams.error.message);
  const saved = new Map<string, string | null>();
  if (weekId) {
    const lineups = await readAllChunks(ids, (part, from, to) => admin
      .from("lineups")
      .select("fantasy_team_id, saved_at")
      .eq("gameweek_id", weekId)
      .in("fantasy_team_id", part)
      .order("id")
      .range(from, to));
    if (lineups.error) throw new Error(lineups.error.message);
    for (const row of lineups.data) saved.set(row.fantasy_team_id as string, (row.saved_at as string | null) ?? null);
  }
  return teams.data
    .map((row) => ({
      id: row.id as string,
      name: String(row.name ?? "Squadra"),
      filed: saved.has(row.id as string),
      savedAt: saved.get(row.id as string) ?? null,
    }))
    .sort((a, b) => Number(a.filed) - Number(b.filed) || a.name.localeCompare(b.name, "it"));
}

export type AdminOverview = {
  matches: { total: number; finished: number; live: number; held: number; nextKickoffAt: string | null };
  votes: { count: number; lastAt: string | null };
  reads: { kind: string; outcome: string; startedAt: string; finishedAt: string | null }[];
  people: { users: number; newThisWeek: number; activeThisWeek: number | null; pushDevices: number };
  audit: { id: string; createdAt: string; label: string }[];
};

async function countRows(table: string, filter?: { column: string; op: "eq" | "gte"; value: string }) {
  const admin = createAdminSupabase();
  const base = admin.from(table).select("*", { count: "exact", head: true });
  const query = !filter ? base : filter.op === "eq" ? base.eq(filter.column, filter.value) : base.gte(filter.column, filter.value);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function activeUsersThisWeek(): Promise<number | null> {
  // L'ultimo accesso sta nel sistema di accesso di Supabase, non nelle tabelle dell'app.
  try {
    const admin = createAdminSupabase();
    const since = Date.now() - 7 * DAY;
    let active = 0;
    for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
      const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listed.error) throw new Error(listed.error.message);
      active += listed.data.users.filter((user) => user.last_sign_in_at && new Date(user.last_sign_in_at).getTime() >= since).length;
      if (listed.data.users.length < 200) break;
    }
    return active;
  } catch (error) {
    reportIfTechnical("Admin: panoramica, ultimi accessi", error);
    return null;
  }
}

export async function loadAdminOverview(week: Week | null): Promise<AdminOverview> {
  const admin = createAdminSupabase();
  const weekSince = new Date(Date.now() - 7 * DAY).toISOString();

  const [matches, votes, lastImport, reads, users, newUsers, webPush, appPush, activeThisWeek, audit] = await Promise.all([
    week
      ? admin.from("real_matches").select("status, kickoff_at, postponed, hold_status").eq("gameweek_id", week.id)
      : Promise.resolve({ data: [], error: null }),
    week ? countRows("player_gameweek_stats", { column: "gameweek_id", op: "eq", value: week.id }) : Promise.resolve(0),
    week
      ? admin.from("vote_imports").select("imported_at").eq("gameweek_id", week.id).neq("source", PROVISIONAL_SOURCE).order("imported_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [], error: null }),
    admin.from("vote_reads").select("kind, outcome, started_at, finished_at").order("started_at", { ascending: false }).limit(6),
    countRows("profiles"),
    countRows("profiles", { column: "created_at", op: "gte", value: weekSince }),
    countRows("push_subscriptions"),
    countRows("device_push_tokens"),
    activeUsersThisWeek(),
    listAdminAudit(3),
  ]);
  if (matches.error) throw new Error(matches.error.message);
  if (lastImport.error) throw new Error(lastImport.error.message);
  if (reads.error) throw new Error(reads.error.message);

  const now = Date.now();
  const matchRows = (matches.data ?? []) as { status: string; kickoff_at: string; postponed: boolean; hold_status: string }[];
  const held = (row: (typeof matchRows)[number]) => row.postponed || (row.hold_status && row.hold_status !== "none");
  const upcoming = matchRows
    .filter((row) => row.status === "scheduled" && !held(row) && new Date(row.kickoff_at).getTime() > now)
    .map((row) => row.kickoff_at)
    .sort();

  return {
    matches: {
      total: matchRows.length,
      finished: matchRows.filter((row) => row.status === "finished").length,
      live: matchRows.filter((row) => row.status === "live" || row.status === "locked").length,
      held: matchRows.filter(held).length,
      nextKickoffAt: upcoming[0] ?? null,
    },
    votes: { count: votes, lastAt: (lastImport.data?.[0]?.imported_at as string | undefined) ?? null },
    reads: (reads.data ?? []).map((row) => ({
      kind: String(row.kind),
      outcome: String(row.outcome),
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string | null) ?? null,
    })),
    people: { users, newThisWeek: newUsers, activeThisWeek, pushDevices: webPush + appPush },
    audit: audit.rows.map((row) => ({ id: row.id, createdAt: row.createdAt, label: ACTION_LABEL[row.action] ?? row.action })),
  };
}
