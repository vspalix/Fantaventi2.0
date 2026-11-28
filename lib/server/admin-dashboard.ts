import {
  findProblems,
  matchProgress,
  PLAYING_DAYS,
  summarizePeople,
  type DashboardAccount,
  type DashboardMatch,
  type DashboardProblem,
  type DashboardRead,
  type PeopleSummary,
} from "@/lib/admin-dashboard";
import { loadAdminLeagues, type AdminLeague } from "@/lib/server/admin-area";
import { readAvailabilitySettings } from "@/lib/server/availability";
import { reportIfTechnical } from "@/lib/server/error-report";
import { readMaintenance } from "@/lib/server/maintenance";
import { inChunks, readAllRows } from "@/lib/server/read-all";
import { readSystemSettings } from "@/lib/server/system-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Dati della Dashboard admin: solo letture, nessuna scrittura nel database.

export type DashboardData = {
  seasonCode: string;
  problems: DashboardProblem[];
  /** null = la lettura non è riuscita. */
  people: PeopleSummary | null;
  week: null | {
    number: number;
    status: string;
    deadlineAt: string;
    locked: boolean;
    matches: { total: number; played: number; live: number };
    lineups: { filed: number; teams: number };
    lastVoteRead: { at: string; outcome: string } | null;
  };
  leagues: { rows: AdminLeague[]; test: number; teams: number };
};

const DAY = 24 * 60 * 60 * 1000;
const VOTE_KINDS = new Set(["halftime", "fulltime", "morning"]);

async function readMatches(weekId: string): Promise<DashboardMatch[]> {
  const { data, error } = await createAdminSupabase()
    .from("real_matches")
    .select("status, kickoff_at, postponed, hold_status")
    .eq("gameweek_id", weekId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    status: String(row.status),
    kickoffAt: row.kickoff_at as string,
    held: Boolean(row.postponed) || Boolean(row.hold_status && row.hold_status !== "none"),
  }));
}

function asRead(row: Record<string, unknown>): DashboardRead {
  return {
    key: String(row.task_key),
    kind: String(row.kind),
    outcome: String(row.outcome),
    startedAt: row.started_at as string,
    weekId: (row.gameweek_id as string | null) ?? null,
  };
}

async function readReads(now: number) {
  const admin = createAdminSupabase();
  const columns = "task_key, kind, outcome, started_at, gameweek_id";
  const [recent, last] = await Promise.all([
    admin.from("vote_reads").select(columns).gte("started_at", new Date(now - 2 * DAY).toISOString()).order("started_at", { ascending: false }).limit(300),
    admin.from("vote_reads").select(columns).order("started_at", { ascending: false }).limit(1),
  ]);
  if (recent.error) throw new Error(recent.error.message);
  if (last.error) throw new Error(last.error.message);
  return { recent: (recent.data ?? []).map(asRead), lastAt: (last.data?.[0]?.started_at as string | undefined) ?? null };
}

/** L'elenco degli account sta nel sistema di accesso di Supabase, a pagine. */
async function readAccounts(): Promise<DashboardAccount[]> {
  const admin = createAdminSupabase();
  const accounts: DashboardAccount[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage });
    if (listed.error) throw new Error(listed.error.message);
    for (const user of listed.data.users) accounts.push({ id: user.id, email: user.email ?? "", createdAt: user.created_at });
    if (listed.data.users.length === 0 || !listed.data.nextPage) break;
  }
  return accounts;
}

async function readPeople(realLeagueIds: string[], now: number): Promise<PeopleSummary> {
  const admin = createAdminSupabase();
  const since = new Date(now - PLAYING_DAYS * DAY).toISOString();
  const [accounts, teams, saved, web, app, memberParts] = await Promise.all([
    readAccounts(),
    readAllRows((from, to) => admin.from("fantasy_teams").select("id, user_id").order("id").range(from, to)),
    readAllRows((from, to) => admin.from("lineups").select("fantasy_team_id").eq("origin", "user").gte("saved_at", since).order("id").range(from, to)),
    readAllRows((from, to) => admin.from("push_subscriptions").select("user_id").order("endpoint").range(from, to)),
    readAllRows((from, to) => admin.from("device_push_tokens").select("user_id").order("token").range(from, to)),
    Promise.all(inChunks(realLeagueIds).map((ids) => readAllRows((from, to) => admin
      .from("private_league_members")
      .select("fantasy_team_id")
      .in("private_league_id", ids)
      .order("private_league_id")
      .order("fantasy_team_id")
      .range(from, to)))),
  ]);
  const failed = [teams, saved, web, app, ...memberParts].find((part) => part.error);
  if (failed?.error) throw new Error(failed.error.message);
  const owner = new Map(teams.data.map((row) => [row.id as string, row.user_id as string]));
  const owners = (rows: { fantasy_team_id: unknown }[]) => rows.flatMap((row) => owner.get(row.fantasy_team_id as string) ?? []);
  return summarizePeople(
    accounts,
    owners(saved.data),
    [...web.data, ...app.data].map((row) => row.user_id as string),
    owners(memberParts.flatMap((part) => part.data)),
    now,
  );
}

export async function loadDashboard(): Promise<DashboardData> {
  const now = Date.now();
  const data = await loadAdminLeagues();
  const real = data.leagues.filter((league) => !league.sandbox);
  const { week } = data;

  // Una fonte che non risponde non deve spegnere tutta la pagina: lo si dice tra le cose da controllare.
  let unreadable = false;
  const attempt = <T,>(where: string, read: Promise<T>): Promise<T | null> => read.catch((error: unknown) => {
    unreadable = true;
    reportIfTechnical(where, error);
    return null;
  });

  const [matches, reads, settings, availability, maintenance, people] = await Promise.all([
    week ? attempt("Dashboard admin: partite", readMatches(week.id)) : Promise.resolve([] as DashboardMatch[]),
    attempt("Dashboard admin: letture dei voti", readReads(now)),
    attempt("Dashboard admin: impostazioni", readSystemSettings()),
    attempt("Dashboard admin: indisponibili", readAvailabilitySettings()),
    attempt("Dashboard admin: manutenzione", readMaintenance()),
    attempt("Dashboard admin: persone", readPeople(real.map((league) => league.id), now)),
  ]);

  const teams = real.reduce((sum, league) => sum + league.teams, 0);
  const filed = real.reduce((sum, league) => sum + league.filed, 0);
  const problems = findProblems({
    now,
    maintenance: maintenance ? maintenance.enabled : null,
    autoReads: settings?.ready ? settings.autoSyncEnabled : null,
    week: week ? { id: week.id, number: Number(week.number), status: week.status, deadlineAt: week.deadline_at } : null,
    matches: matches ?? [],
    reads: reads?.recent ?? null,
    lastReadAt: reads?.lastAt ?? null,
    availability: availability?.ready
      ? {
        manual: availability.settings.provider === "manual",
        lastSyncAt: availability.settings.lastSyncAt,
        unmatched: availability.settings.unmatched.length,
      }
      : null,
    missingLineups: Math.max(0, teams - filed),
  });
  if (unreadable) {
    problems.push({ id: "unreadable", tone: "warn", title: "Qualche dato non si è caricato", detail: "Ricarica la pagina tra poco.", href: "/admin" });
  }

  const lastVoteRead = reads?.recent.find((read) => VOTE_KINDS.has(read.kind) && read.weekId === week?.id && read.outcome !== "alert") ?? null;
  return {
    seasonCode: data.seasonCode,
    problems,
    people,
    week: week
      ? {
        number: Number(week.number),
        status: week.status,
        deadlineAt: week.deadline_at,
        locked: data.locked,
        matches: matchProgress(matches ?? [], now),
        lineups: { filed, teams },
        lastVoteRead: lastVoteRead ? { at: lastVoteRead.startedAt, outcome: lastVoteRead.outcome } : null,
      }
      : null,
    leagues: { rows: real, test: data.leagues.length - real.length, teams },
  };
}
