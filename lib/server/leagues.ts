import { cache } from "react";
import { createJoinCode } from "@/lib/join-code";
import { publicHandle } from "@/lib/public-name";
import { newLeagueRange, parseLeagueRules, type LeagueRange, type LeagueRules } from "@/lib/league-rules";
import { leagueActor } from "@/lib/server/access-policy";
import { isSuperAdmin } from "@/lib/server/platform-role";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { readLeagueSettings } from "@/lib/server/league-settings";
import { changedScoring, nextScoringHistory, scoringLabel } from "@/lib/scoring-history";
import type { LeagueDetail, LeagueSummary, RosterImportSource, ScoringChoice } from "@/lib/types";
import { createDedicatedTeam, ensureProfile, getCurrentSeason, listSeasonTeams, teamInLeague } from "@/lib/server/catalog";
import { rosterAppliesFrom } from "@/lib/server/gameweek-cycle";
import { missingSandboxColumn } from "@/lib/server/sandbox-flag";

type LeagueRow = {
  id: string;
  name: string;
  join_code: string;
  season_id: string;
  owner_user_id: string;
  start_matchday?: number;
  end_matchday?: number;
};

type FantasyRow = { id: string; name: string; user_id: string };

type JoinedLeague = {
  id: string;
  name: string;
  join_code: string;
  season_id: string;
  owner_user_id: string;
};

function matchday(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

async function readLeagueRow(admin: ReturnType<typeof createAdminSupabase>, leagueId: string) {
  const withRange = await admin
    .from("private_leagues")
    .select("id, name, join_code, season_id, owner_user_id, start_matchday, end_matchday")
    .eq("id", leagueId)
    .maybeSingle();

  if (!withRange.error && withRange.data) {
    const row = withRange.data as LeagueRow;
    return {
      row,
      startMatchday: matchday(row.start_matchday, 1),
      endMatchday: matchday(row.end_matchday, 38),
      rangeReady: true,
    };
  }

  if (withRange.error && !/start_matchday|end_matchday/i.test(withRange.error.message)) {
    throw new Error(withRange.error.message);
  }

  const plain = await admin
    .from("private_leagues")
    .select("id, name, join_code, season_id, owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();
  if (plain.error) throw new Error(plain.error.message);
  if (!plain.data) return null;
  return {
    row: plain.data as LeagueRow,
    startMatchday: 1,
    endMatchday: 38,
    rangeReady: false,
  };
}

async function seasonRoundCount(admin: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const { count, error } = await admin
    .from("gameweeks")
    .select("id", { count: "exact", head: true })
    .eq("season_id", seasonId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function missingDelegates(message: string) {
  return /league_delegates|schema cache|could not find|relation/i.test(message);
}

async function delegateLeagueIds(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { data, error } = await admin.from("league_delegates").select("league_id").eq("user_id", userId);
  if (error) {
    if (missingDelegates(error.message)) return new Set<string>();
    throw new Error(error.message);
  }
  return new Set((data ?? []).map((row) => row.league_id as string));
}

async function delegateUserIds(admin: ReturnType<typeof createAdminSupabase>, leagueId: string) {
  const { data, error } = await admin.from("league_delegates").select("user_id").eq("league_id", leagueId);
  if (error) {
    if (missingDelegates(error.message)) return [] as string[];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => row.user_id as string);
}

async function seasonCode(admin: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const { data } = await admin.from("seasons").select("code").eq("id", seasonId).maybeSingle();
  return (data?.code as string | undefined) ?? "";
}

export const listLeaguesForUser = cache(async (userId: string): Promise<LeagueSummary[]> => {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const ownedLeagues = async () => {
    const scoped = await admin
      .from("private_leagues")
      .select("id, name, join_code, season_id")
      .eq("owner_user_id", userId)
      .eq("season_id", season.id)
      .eq("is_sandbox", false);
    return scoped.error && missingSandboxColumn(scoped.error.message)
      ? admin.from("private_leagues").select("id, name, join_code, season_id").eq("owner_user_id", userId).eq("season_id", season.id)
      : scoped;
  };
  // Letture indipendenti: partono insieme, ognuna costa un viaggio al database.
  const [teams, ownedResult, delegated] = await Promise.all([
    listSeasonTeams(admin, userId, season.id),
    ownedLeagues(),
    delegateLeagueIds(admin, userId),
  ]);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  if (ownedResult.error) throw new Error(ownedResult.error.message);
  const owned = ownedResult.data;

  const memberships = teams.length === 0
    ? { data: [] as { fantasy_team_id: string; private_leagues: JoinedLeague | JoinedLeague[] | null }[], error: null }
    : await admin
      .from("private_league_members")
      .select("fantasy_team_id, private_leagues(id, name, join_code, season_id, owner_user_id)")
      .in("fantasy_team_id", teams.map((team) => team.id));
  if (memberships.error) throw new Error(memberships.error.message);

  const byId = new Map<string, LeagueSummary>();
  for (const row of memberships.data ?? []) {
    const league = one(row.private_leagues as JoinedLeague | JoinedLeague[] | null);
    if (!league || league.season_id !== season.id) continue;
    const team = teamById.get(row.fantasy_team_id as string);
    const isOwner = league.owner_user_id === userId;
    byId.set(league.id, {
      id: league.id,
      name: league.name,
      joinCode: league.join_code,
      seasonCode: season.code,
      isOwner,
      isManager: isOwner || delegated.has(league.id),
      teamId: team?.id ?? null,
      teamName: team?.name ?? "",
    });
  }
  for (const league of owned ?? []) {
    if (byId.has(league.id as string)) continue;
    byId.set(league.id as string, {
      id: league.id as string,
      name: league.name as string,
      joinCode: league.join_code as string,
      seasonCode: season.code,
      isOwner: true,
      isManager: true,
      teamId: null,
      teamName: "",
    });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
});

/** `carry: false` quando chi chiama scrive subito la rosa (scelta o importata). */
export async function ensureLeagueTeam(userId: string, leagueId: string, preferredName?: string, options?: { carry?: boolean }) {
  const admin = createAdminSupabase();
  const league = await admin.from("private_leagues").select("id, season_id, start_matchday").eq("id", leagueId).maybeSingle();
  if (league.error) throw new Error(league.error.message);
  if (!league.data) throw httpError("Lega non trovata.", 404);
  const seasonId = league.data.season_id as string;
  const name = preferredName?.trim() ?? "";
  const existing = await teamInLeague(admin, userId, leagueId);
  if (existing) {
    if (name && name !== existing.name) {
      const { error } = await admin.from("fantasy_teams").update({ name }).eq("id", existing.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { id: existing.id, name };
    }
    return existing;
  }

  const teams = await listSeasonTeams(admin, userId, seasonId);
  const taken = teams.length === 0
    ? { data: [] as { fantasy_team_id: string }[], error: null }
    : await admin.from("private_league_members").select("fantasy_team_id").in("fantasy_team_id", teams.map((team) => team.id));
  if (taken.error) throw new Error(taken.error.message);
  const used = new Set((taken.data ?? []).map((row) => row.fantasy_team_id as string));
  // Chi entra in una lega già iniziata deve entrare «nuovo»: una squadra che ha già formazioni
  // o rosa nelle giornate chiuse di questa lega le porterebbe con sé e salterebbe la media.
  const available = teams.filter((team) => !used.has(team.id));
  const closed = await closedWeeksOf(admin, seasonId, Number(league.data.start_matchday ?? 1));
  let free: (typeof available)[number] | undefined;
  for (const candidate of available) {
    if (await carriesHistory(admin, candidate.id, closed)) continue;
    free = candidate;
    break;
  }
  /** La squadra libera lasciata da parte: resta com'è, la sua rosa si può copiare in quella nuova. */
  const setAside = free ? undefined : available[0];
  const team = free
    ? { id: free.id, name: free.name }
    : {
      id: await createDedicatedTeam(admin, userId, seasonId, name || setAside?.name || "La mia squadra"),
      name: name || setAside?.name || "La mia squadra",
    };
  if (free && name && name !== free.name) {
    const { error } = await admin.from("fantasy_teams").update({ name }).eq("id", free.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    team.name = name;
  }
  const { error } = await admin.from("private_league_members").insert({
    private_league_id: leagueId,
    fantasy_team_id: team.id,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
  if (setAside && options?.carry !== false) await carryRoster(admin, leagueId, seasonId, team.id, setAside.id);
  return team;
}

/** Le giornate di una lega che sono già chiuse per chi entra adesso. */
async function closedWeeksOf(admin: ReturnType<typeof createAdminSupabase>, seasonId: string, startMatchday: number) {
  const next = await rosterAppliesFrom(admin, seasonId);
  if (next <= startMatchday) return { from: startMatchday, ids: [] as string[] };
  const weeks = await admin
    .from("gameweeks")
    .select("id")
    .eq("season_id", seasonId)
    .gte("number", startMatchday)
    .lt("number", next);
  if (weeks.error) throw new Error(weeks.error.message);
  return { from: startMatchday, next, ids: (weeks.data ?? []).map((row) => row.id as string) };
}

async function carriesHistory(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  closed: { from: number; next?: number; ids: string[] },
) {
  if (closed.ids.length === 0 || closed.next === undefined) return false;
  const [lineups, stints] = await Promise.all([
    admin.from("lineups").select("id").eq("fantasy_team_id", teamId).in("gameweek_id", closed.ids).limit(1),
    admin.from("roster_stints").select("active_from_gameweek, active_until_gameweek").eq("fantasy_team_id", teamId),
  ]);
  if (lineups.error) throw new Error(lineups.error.message);
  if (stints.error) throw new Error(stints.error.message);
  const next = closed.next;
  return (lineups.data ?? []).length > 0 || (stints.data ?? []).some((row) => (
    Number(row.active_from_gameweek) < next
    && (row.active_until_gameweek === null || Number(row.active_until_gameweek) >= closed.from)
  ));
}

/** Se per entrare è nata una squadra nuova, ci porta la rosa attuale di quella lasciata da parte. */
async function carryRoster(
  admin: ReturnType<typeof createAdminSupabase>,
  leagueId: string,
  seasonId: string,
  teamId: string,
  sourceTeamId: string,
) {
  // Nelle leghe a rose esclusive la rosa si ricompone: potrebbe contenere calciatori già presi.
  if ((await readLeagueSettings(admin, leagueId)).rules.exclusiveRosters) return;
  const playerIds = await openRosterIds(admin, sourceTeamId);
  if (playerIds.length > 0) await copyOpenRoster(admin, teamId, seasonId, playerIds);
}

/** Le giornate tra cui si può scegliere per una lega nuova. */
export async function seasonCalendar(admin: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const [rounds, open] = await Promise.all([
    seasonRoundCount(admin, seasonId),
    admin
      .from("gameweeks")
      .select("number, deadline_at")
      .eq("season_id", seasonId)
      .in("status", ["scheduled", "open"])
      .gt("deadline_at", new Date().toISOString())
      .order("number", { ascending: true })
      .limit(1),
  ]);
  if (open.error) throw new Error(open.error.message);
  const last = rounds > 0 ? rounds : 38;
  const first = open.data?.[0];
  return {
    rounds,
    last,
    next: first ? Number(first.number) : last,
    nextDeadlineAt: first ? (first.deadline_at as string) : null,
  };
}

export async function createLeague(
  userId: string,
  email: string | undefined,
  name: string,
  rulesInput?: unknown,
  rangeInput?: { startMatchday?: unknown; endMatchday?: unknown },
) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw new Error("Il nome della lega deve avere tra 2 e 40 caratteri.");
  }
  // Una lega nuova non ha giornate passate con regole diverse.
  const rules = { ...parseLeagueRules(rulesInput), scoringHistory: [] };

  const admin = createAdminSupabase();
  await ensureProfile(admin, userId, email);
  const season = await getCurrentSeason(admin);
  const id = crypto.randomUUID();
  // La scelta delle giornate si controlla prima di creare qualsiasi cosa.
  const calendar = await seasonCalendar(admin, season.id);
  let chosen: LeagueRange | null = null;
  if (rangeInput?.startMatchday !== undefined) {
    const range = newLeagueRange(rangeInput.startMatchday, rangeInput.endMatchday, calendar.next, calendar.last);
    if (typeof range === "string") throw httpError(range, 400);
    chosen = range;
  }

  let joinCode = createJoinCode();
  let created = false;
  let rulesStored = true;
  for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
    const withRules = await admin.from("private_leagues").insert({
      id,
      season_id: season.id,
      owner_user_id: userId,
      name: trimmed,
      join_code: joinCode,
      settings: rules,
      competition_format: rules.format,
    });
    let error = withRules.error;
    if (error && /competition_format|schema cache|could not find/i.test(error.message)) {
      error = (await admin.from("private_leagues").insert({
        id,
        season_id: season.id,
        owner_user_id: userId,
        name: trimmed,
        join_code: joinCode,
        settings: rules,
      })).error;
    }
    if (error && /settings/i.test(error.message)) {
      rulesStored = false;
      error = (await admin.from("private_leagues").insert({
        id,
        season_id: season.id,
        owner_user_id: userId,
        name: trimmed,
        join_code: joinCode,
      })).error;
    }
    if (!error) {
      created = true;
      break;
    }
    if (!error.message.toLowerCase().includes("join_code")) throw new Error(error.message);
    joinCode = createJoinCode();
  }
  if (!created) throw new Error("Non sono riuscito a generare un codice invito univoco.");

  const rangePatch: { start_matchday: number; end_matchday?: number } = { start_matchday: chosen?.from ?? 1 };
  const end = chosen?.to ?? calendar.rounds;
  if (end > 0) rangePatch.end_matchday = end;
  const updated = await admin.from("private_leagues").update(rangePatch).eq("id", id);
  const missingColumn = Boolean(updated.error
    && /column|schema cache/i.test(updated.error.message)
    && /start_matchday|end_matchday/i.test(updated.error.message));
  if (updated.error && !missingColumn) {
    throw new Error(
      /38|check constraint/i.test(updated.error.message)
        ? "Il range giornate è ancora limitato a 38. Esegui multi_competition.sql."
        : updated.error.message,
    );
  }

  let squad: { id: string; name: string };
  try {
    squad = await ensureLeagueTeam(userId, id);
  } catch (error) {
    await admin.from("private_leagues").delete().eq("id", id);
    throw error;
  }

  return {
    id,
    name: trimmed,
    joinCode,
    seasonCode: season.code,
    isOwner: true,
    isManager: true,
    teamId: squad.id,
    teamName: squad.name,
    rules,
    rulesStored,
  };
}

async function openRosterIds(admin: ReturnType<typeof createAdminSupabase>, teamId: string) {
  const rows = await admin
    .from("roster_stints")
    .select("player_id")
    .eq("fantasy_team_id", teamId)
    .is("active_until_gameweek", null);
  if (rows.error) throw new Error(rows.error.message);
  return [...new Set((rows.data ?? []).map((row) => row.player_id as string))];
}

export async function importableRosters(userId: string, exceptLeagueId: string): Promise<RosterImportSource[]> {
  const admin = createAdminSupabase();
  const leagues = await listLeaguesForUser(userId);
  const sources: RosterImportSource[] = [];
  for (const league of leagues) {
    if (league.id === exceptLeagueId || !league.teamId) continue;
    const players = (await openRosterIds(admin, league.teamId)).length;
    if (players === 0) continue;
    sources.push({
      leagueId: league.id,
      leagueName: league.name,
      teamName: league.teamName,
      players,
    });
  }
  return sources;
}

async function leagueByJoinCode(admin: ReturnType<typeof createAdminSupabase>, code: string) {
  const joinCode = code.trim().toUpperCase();
  if (joinCode.length < 4) throw new Error("Inserisci il codice invito.");
  const flagged = await admin
    .from("private_leagues")
    .select("id, name, join_code, season_id, is_sandbox")
    .eq("join_code", joinCode)
    .maybeSingle();
  const plainLeague = flagged.error && missingSandboxColumn(flagged.error.message)
    ? await admin.from("private_leagues").select("id, name, join_code, season_id").eq("join_code", joinCode).maybeSingle()
    : flagged;
  if (plainLeague.error) throw new Error(plainLeague.error.message);
  const league = plainLeague.data as { id: string; name: string; join_code: string; season_id: string; is_sandbox?: boolean } | null;
  if (!league) throw new Error("Nessuna lega trovata con questo codice.");
  if (league.is_sandbox) throw new Error("Questo codice appartiene al laboratorio sandbox e non iscrive a una lega reale.");
  return league;
}

export async function joinRosterOffer(userId: string, input: { code?: string; leagueId?: string }) {
  const admin = createAdminSupabase();
  let leagueId = input.leagueId?.trim() ?? "";
  let name = "";
  if (leagueId) {
    const { rules, ready } = await readLeagueSettings(admin, leagueId);
    if (!ready || rules.visibility !== "public") throw httpError("Questa lega non è pubblica. Serve il codice invito.", 403);
    const row = await admin.from("private_leagues").select("name").eq("id", leagueId).maybeSingle();
    if (row.error) throw new Error(row.error.message);
    if (!row.data) throw httpError("Lega non trovata.", 404);
    name = row.data.name as string;
  } else {
    const league = await leagueByJoinCode(admin, input.code ?? "");
    leagueId = league.id;
    name = league.name;
  }
  if (await teamInLeague(admin, userId, leagueId)) return { needed: false, targetName: name, sources: [] as RosterImportSource[] };
  const sources = await importableRosters(userId, leagueId);
  return { needed: sources.length > 0, targetName: name, sources };
}

async function rosterToImport(admin: ReturnType<typeof createAdminSupabase>, userId: string, targetLeagueId: string, sourceLeagueId: string) {
  if (sourceLeagueId === targetLeagueId) throw httpError("Scegli una rosa di un'altra lega.", 400);
  const source = await teamInLeague(admin, userId, sourceLeagueId);
  if (!source) throw httpError("Questa rosa non è tra le tue.", 403);
  const playerIds = await openRosterIds(admin, source.id);
  if (playerIds.length === 0) throw httpError("Quella rosa non ha calciatori da portare.", 409);
  const settings = await readLeagueSettings(admin, targetLeagueId);
  if (settings.ready && settings.rules.exclusiveRosters) {
    const members = await admin.from("private_league_members").select("fantasy_team_id").eq("private_league_id", targetLeagueId);
    if (members.error) throw new Error(members.error.message);
    const otherIds = (members.data ?? []).map((row) => row.fantasy_team_id as string);
    if (otherIds.length > 0) {
      const taken = await admin
        .from("roster_stints")
        .select("player_id")
        .in("fantasy_team_id", otherIds)
        .is("active_until_gameweek", null);
      if (taken.error) throw new Error(taken.error.message);
      const owned = new Set((taken.data ?? []).map((row) => row.player_id as string));
      if (playerIds.some((playerId) => owned.has(playerId))) {
        throw httpError("In questa lega le rose sono esclusive e alcuni calciatori sono già in un'altra squadra. Puoi entrare con una rosa vuota.", 409);
      }
    }
  }
  return playerIds;
}

async function copyOpenRoster(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  seasonId: string,
  playerIds: string[],
) {
  const from = await rosterAppliesFrom(admin, seasonId);
  const inserted = await admin.from("roster_stints").insert(playerIds.map((playerId) => ({
    id: crypto.randomUUID(),
    fantasy_team_id: teamId,
    player_id: playerId,
    active_from_gameweek: from,
    active_until_gameweek: null,
  })));
  if (inserted.error) throw new Error(inserted.error.message);
}

export async function joinLeague(
  userId: string,
  email: string | undefined,
  code: string,
  importFromLeagueId?: string | null,
) {
  const admin = createAdminSupabase();
  await ensureProfile(admin, userId, email);
  const league = await leagueByJoinCode(admin, code);

  let imported: string[] | null = null;
  const already = await teamInLeague(admin, userId, league.id as string);
  if (!already) {
    await assertCanJoin(admin, league.id as string, league.season_id as string);
    if (importFromLeagueId) imported = await rosterToImport(admin, userId, league.id as string, importFromLeagueId);
  }
  const squad = already ?? await ensureLeagueTeam(userId, league.id as string, undefined, { carry: !imported });
  if (imported) await copyOpenRoster(admin, squad.id, league.season_id as string, imported);

  return {
    id: league.id as string,
    name: league.name as string,
    joinCode: league.join_code as string,
    seasonCode: await seasonCode(admin, league.season_id as string),
    isOwner: false,
    isManager: false,
    teamId: squad.id,
    teamName: squad.name,
  };
}

export const getLeagueDetail = cache(async (userId: string, leagueId: string): Promise<LeagueDetail> => {
  const admin = createAdminSupabase();
  const loaded = await readLeagueRow(admin, leagueId);
  if (!loaded) throw httpError("Lega non trovata.", 404);
  const { row: league, startMatchday, endMatchday, rangeReady } = loaded;
  const [sandboxFlag, team, roundCount, delegateIds, platformOverride, members, code, settings] = await Promise.all([
    admin.from("private_leagues").select("is_sandbox").eq("id", leagueId).maybeSingle(),
    teamInLeague(admin, userId, leagueId),
    seasonRoundCount(admin, league.season_id as string),
    delegateUserIds(admin, leagueId),
    isSuperAdmin(userId),
    admin
      .from("private_league_members")
      .select("fantasy_team_id, fantasy_teams(id, name, user_id)")
      .eq("private_league_id", leagueId),
    seasonCode(admin, league.season_id as string),
    readLeagueSettings(admin, league.id),
  ]);
  if (!sandboxFlag.error && (sandboxFlag.data as { is_sandbox?: boolean } | null)?.is_sandbox) {
    throw httpError("Questa lega è il laboratorio sandbox e resta fuori dal gioco.", 404);
  }

  const isOwner = league.owner_user_id === userId;
  const membership = team ? { fantasy_team_id: team.id } : null;

  const actor = leagueActor({
    userId,
    ownerId: String(league.owner_user_id),
    delegateIds,
    isMember: Boolean(membership),
    platformAdmin: platformOverride,
  });
  if (!actor.canEnter) throw httpError("Non fai parte di questa lega.", 403);
  const isManager = actor.isManager;

  if (members.error) throw new Error(members.error.message);
  const teams = (members.data ?? []).flatMap((row) => {
    const fantasy = one(row.fantasy_teams as FantasyRow | FantasyRow[] | null);
    return fantasy ? [fantasy] : [];
  });

  const userIds = [...new Set([...teams.map((row) => row.user_id), ...delegateIds])];
  const { data: profiles, error: profilesError } = userIds.length
    ? await admin.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [], error: null };
  if (profilesError) throw new Error(profilesError.message);

  const names = new Map((profiles ?? []).map((profile) => [profile.id as string, publicHandle(profile.display_name as string)]));
  const participants = teams.map((row) => {
    const userId = row.user_id;
    const role = userId === league.owner_user_id ? "owner" : delegateIds.includes(userId) ? "admin" : "member";
    return {
      fantasyTeamId: row.id,
      userId,
      teamName: row.name,
      displayName: names.get(userId) ?? "",
      role,
    } as const;
  }).sort((a, b) => a.teamName.localeCompare(b.teamName, "it"));
  const delegates = delegateIds
    .filter((id) => id !== league.owner_user_id)
    .map((id) => ({
      userId: id,
      displayName: names.get(id) || participants.find((participant) => participant.userId === id)?.displayName || "Admin",
    }));

  return {
    id: league.id as string,
    name: league.name as string,
    joinCode: league.join_code as string,
    seasonCode: code,
    isOwner,
    isManager,
    platformOverride,
    teamId: team?.id ?? null,
    teamName: team?.name ?? "",
    isMember: Boolean(membership),
    delegates,
    participants,
    startMatchday,
    endMatchday,
    rangeReady,
    seasonId: league.season_id,
    roundCount,
    rules: settings.rules,
  };
});

async function assertCanJoin(
  admin: ReturnType<typeof createAdminSupabase>,
  leagueId: string,
  seasonId: string,
) {
  const { rules, ready } = await readLeagueSettings(admin, leagueId);
  if (!ready || rules.enrollment !== "closed") return;
  const { count, error } = await admin
    .from("private_league_members")
    .select("fantasy_team_id", { count: "exact", head: true })
    .eq("private_league_id", leagueId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= (rules.maxMembers ?? 0)) {
    throw httpError("La lega ha tutti gli slot occupati.", 409);
  }
  const { data: weeks, error: weekError } = await admin
    .from("gameweeks")
    .select("number, status, deadline_at")
    .eq("season_id", seasonId);
  if (weekError) throw new Error(weekError.message);
  const started = (weeks ?? []).some((week) => (
    week.status === "locked"
    || week.status === "scored"
    || week.status === "final"
    || new Date(week.deadline_at as string).getTime() <= Date.now()
  ));
  if (started) throw httpError("Questa lega è a numero chiuso e non accetta ingressi a campionato iniziato.", 409);
}

/** `own`: le leghe dell'utente, se chi chiama le sta già leggendo (evita di calcolarle due volte). */
export async function listPublicLeagues(userId: string, own?: Promise<LeagueSummary[]>): Promise<LeagueSummary[]> {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const [extended, joined] = await Promise.all([
    admin
      .from("private_leagues")
      .select("id, name, join_code, settings")
      .eq("season_id", season.id),
    own ?? listLeaguesForUser(userId),
  ]);
  if (extended.error) {
    if (/settings/i.test(extended.error.message)) return [];
    throw new Error(extended.error.message);
  }
  const mine = new Set(joined.map((league) => league.id));
  return (extended.data ?? []).flatMap((row) => {
    const rules = parseLeagueRules(row.settings);
    if (rules.visibility !== "public" || mine.has(row.id as string)) return [];
    return [{
      id: row.id as string,
      name: row.name as string,
      joinCode: row.join_code as string,
      seasonCode: season.code,
      isOwner: false,
      isManager: false,
      teamId: null,
      teamName: "",
    }];
  });
}

export async function joinPublicLeague(
  userId: string,
  email: string | undefined,
  leagueId: string,
  importFromLeagueId?: string | null,
) {
  const admin = createAdminSupabase();
  await ensureProfile(admin, userId, email);
  const season = await getCurrentSeason(admin);
  const { rules, ready } = await readLeagueSettings(admin, leagueId);
  if (!ready || rules.visibility !== "public") {
    throw httpError("Questa lega non è pubblica. Serve il codice invito.", 403);
  }
  let imported: string[] | null = null;
  const already = await teamInLeague(admin, userId, leagueId);
  if (!already) {
    await assertCanJoin(admin, leagueId, season.id);
    if (importFromLeagueId) imported = await rosterToImport(admin, userId, leagueId, importFromLeagueId);
  }
  const { data: league, error } = await admin
    .from("private_leagues")
    .select("id, name, join_code")
    .eq("id", leagueId)
    .eq("season_id", season.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!league) throw httpError("Lega non trovata.", 404);
  const squad = already ?? await ensureLeagueTeam(userId, leagueId, undefined, { carry: !imported });
  if (imported) await copyOpenRoster(admin, squad.id, season.id, imported);
  return {
    id: league.id as string,
    name: league.name as string,
    joinCode: league.join_code as string,
    seasonCode: season.code,
    isOwner: false,
    isManager: false,
    teamId: squad.id,
    teamName: squad.name,
  };
}

/** La prima giornata che non è ancora cominciata. A calendario finito, quella dopo l'ultima. */
async function firstOpenMatchday(admin: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const open = await admin
    .from("gameweeks")
    .select("number")
    .eq("season_id", seasonId)
    .in("status", ["scheduled", "open"])
    .gt("deadline_at", new Date().toISOString())
    .order("number", { ascending: true })
    .limit(1);
  if (open.error) throw new Error(open.error.message);
  if (open.data?.[0]) return Number(open.data[0].number);
  const rounds = await seasonRoundCount(admin, seasonId);
  return (rounds > 0 ? rounds : 38) + 1;
}

export async function updateLeague(
  userId: string,
  leagueId: string,
  input: {
    name?: string;
    regenerateCode?: boolean;
    startMatchday?: number;
    endMatchday?: number;
    rules?: Partial<LeagueRules>;
    /** Se cambia un bonus a lega iniziata: vale da ora o per tutte le giornate. */
    scoringApply?: unknown;
    grantDelegateUserId?: string;
    revokeDelegateUserId?: string;
  },
) {
  const detail = await getLeagueDetail(userId, leagueId);
  if (!detail.isManager) throw httpError("Solo l'admin della lega può modificarla.", 403);

  const admin = createAdminSupabase();
  const patch: { name?: string; join_code?: string; start_matchday?: number; end_matchday?: number } = {};
  if (typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (trimmed.length < 2 || trimmed.length > 40) {
      throw new Error("Il nome della lega deve avere tra 2 e 40 caratteri.");
    }
    patch.name = trimmed;
  }
  if (input.regenerateCode) patch.join_code = createJoinCode();

  const hasRange = input.startMatchday !== undefined || input.endMatchday !== undefined;
  if (hasRange) {
    if (!detail.rangeReady) {
      throw new Error("Per salvare il range giornate esegui league_hub.sql nell'editor SQL di Supabase.");
    }
    const start = input.startMatchday ?? detail.startMatchday;
    const end = input.endMatchday ?? detail.endMatchday;
    const rounds = detail.roundCount;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end || (rounds > 0 && end > rounds)) {
      throw new Error(
        rounds > 0
          ? `Il range deve stare tra la giornata 1 e la ${rounds}, con inizio non successivo alla fine.`
          : "Il range deve partire dalla giornata 1, con inizio non successivo alla fine.",
      );
    }
    patch.start_matchday = start;
    patch.end_matchday = end;
  }

  const current = (await readLeagueSettings(admin, leagueId)).rules;
  const rules = input.rules ? parseLeagueRules({
    ...current,
    ...input.rules,
    bonusMalus: { ...current.bonusMalus, ...input.rules.bonusMalus },
    bonusEnabled: { ...current.bonusEnabled, ...input.rules.bonusEnabled },
    phases: input.rules.phases ?? current.phases,
    checkpoints: input.rules.checkpoints ?? current.checkpoints,
  }, input.rules.format ?? current.format) : null;
  if (rules) {
    // Lo storico dei bonus lo scrive solo il server: quello arrivato dalla richiesta non conta.
    rules.scoringHistory = current.scoringHistory;
    if (rules.enrollment === "closed" && detail.participants.length > (rules.maxMembers ?? 0)) {
      throw httpError(`Nella lega ci sono già ${detail.participants.length} squadre: i posti non possono essere di meno.`, 409);
    }
    const changed = changedScoring(current, rules);
    if (changed.length > 0) {
      const start = patch.start_matchday ?? detail.startMatchday;
      const from = await firstOpenMatchday(admin, detail.seasonId);
      const apply = input.scoringApply === "from-now" || input.scoringApply === "all" ? input.scoringApply : null;
      // Senza giornate già iniziate non c'è niente da scegliere.
      if (from > start && !apply) {
        const choice: ScoringChoice = { fromMatchday: from, changed: changed.map(scoringLabel) };
        throw Object.assign(httpError("Scegli se la modifica vale da ora o per tutte le giornate.", 409), { scoringChoice: choice });
      }
      rules.scoringHistory = nextScoringHistory(current, rules, from > start ? apply ?? "all" : "all", from);
    }
  }
  if (input.grantDelegateUserId || input.revokeDelegateUserId) {
    if (!detail.isOwner && !detail.platformOverride) throw httpError("Solo chi ha creato la lega può nominare un admin.", 403);
    if (input.grantDelegateUserId) {
      if (input.grantDelegateUserId === userId) throw httpError("Sei già l'admin della lega.", 409);
      if (!detail.participants.some((participant) => participant.userId === input.grantDelegateUserId)) {
        throw httpError("Puoi nominare solo un partecipante della lega.", 409);
      }
      const granted = await admin.from("league_delegates").upsert({
        league_id: leagueId,
        user_id: input.grantDelegateUserId,
        granted_by: userId,
      }, { onConflict: "league_id,user_id" });
      if (granted.error) {
        if (missingDelegates(granted.error.message)) {
          throw httpError("Per gli admin delegati esegui league_roles.sql nell'editor SQL di Supabase.", 409);
        }
        throw new Error(granted.error.message);
      }
    }
    if (input.revokeDelegateUserId) {
      const revoked = await admin.from("league_delegates").delete().eq("league_id", leagueId).eq("user_id", input.revokeDelegateUserId);
      if (revoked.error) {
        if (missingDelegates(revoked.error.message)) {
          throw httpError("Per gli admin delegati esegui league_roles.sql nell'editor SQL di Supabase.", 409);
        }
        throw new Error(revoked.error.message);
      }
    }
  }

  if (!patch.name && !patch.join_code && !hasRange && !rules) return getLeagueDetail(userId, leagueId);

  const saved = rules
    ? await admin.from("private_leagues").update({ ...patch, settings: rules, competition_format: rules.format }).eq("id", leagueId)
    : await admin.from("private_leagues").update(patch).eq("id", leagueId);
  let error = saved.error;
  if (error && rules && /competition_format|schema cache|could not find/i.test(error.message)) {
    error = (await admin.from("private_leagues").update({ ...patch, settings: rules }).eq("id", leagueId)).error;
  }
  if (error) throw new Error(error.message);
  return getLeagueDetail(userId, leagueId);
}

export async function removeParticipant(userId: string, leagueId: string, fantasyTeamId: string) {
  const detail = await getLeagueDetail(userId, leagueId);
  if (!detail.isManager) throw httpError("Solo l'admin della lega può rimuovere un partecipante.", 403);

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("private_league_members")
    .delete()
    .eq("private_league_id", leagueId)
    .eq("fantasy_team_id", fantasyTeamId);
  if (error) throw new Error(error.message);
  return getLeagueDetail(userId, leagueId);
}
