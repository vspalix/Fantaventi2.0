import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentSeason } from "@/lib/server/catalog";
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
    // Con tante squadre una sola richiesta non basta: si legge a blocchi, pochi alla volta, e a pagine.
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
    if (week) {
      // Le formazioni d'ufficio non sono consegne. Si legge la giornata intera: meno richieste che a elenchi di squadre.
      const lineups = await readAllRows((from, to) => admin
        .from("lineups")
        .select("fantasy_team_id")
        .eq("gameweek_id", week.id)
        .eq("origin", "user")
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
      .eq("origin", "user")
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
