import { createJoinCode } from "@/lib/join-code";
import { parseLeagueRules, type LeagueRules } from "@/lib/league-rules";
import { isSuperAdmin } from "@/lib/server/platform-role";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { readLeagueSettings } from "@/lib/server/league-settings";
import type { LeagueDetail, LeagueSummary } from "@/lib/types";
import { ensureProfile, getCurrentSeason, getFantasyTeam } from "@/lib/server/catalog";

type LeagueRow = {
  id: string;
  name: string;
  join_code: string;
  season_id: string;
  owner_user_id: string;
  start_matchday?: number;
  end_matchday?: number;
};

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

export async function listLeaguesForUser(userId: string): Promise<LeagueSummary[]> {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const team = await getFantasyTeam(admin, userId, season.id);

  const { data: owned, error: ownedError } = await admin
    .from("private_leagues")
    .select("id, name, join_code, season_id")
    .eq("owner_user_id", userId)
    .eq("season_id", season.id);
  if (ownedError) throw new Error(ownedError.message);

  let joined: { id: string; name: string; join_code: string }[] = [];
  if (team) {
    const { data: memberships, error } = await admin
      .from("private_league_members")
      .select("private_leagues(id, name, join_code, season_id, owner_user_id)")
      .eq("fantasy_team_id", team.id);
    if (error) throw new Error(error.message);
    joined = (memberships ?? []).flatMap((row) => {
      const league = one(row.private_leagues as JoinedLeague | JoinedLeague[] | null);
      if (!league || league.season_id !== season.id || league.owner_user_id === userId) return [];
      return [{ id: league.id, name: league.name, join_code: league.join_code }];
    });
  }

  const ownedIds = new Set((owned ?? []).map((league) => league.id as string));
  const delegated = await delegateLeagueIds(admin, userId);
  const summaries: LeagueSummary[] = [
    ...(owned ?? []).map((league) => ({
      id: league.id as string,
      name: league.name as string,
      joinCode: league.join_code as string,
      seasonCode: season.code,
      isOwner: true,
      isManager: true,
    })),
    ...joined
      .filter((league) => !ownedIds.has(league.id))
      .map((league) => ({
        id: league.id,
        name: league.name,
        joinCode: league.join_code,
        seasonCode: season.code,
        isOwner: false,
        isManager: delegated.has(league.id),
      })),
  ];

  return summaries.sort((a, b) => a.name.localeCompare(b.name, "it"));
}

export async function createLeague(
  userId: string,
  email: string | undefined,
  name: string,
  rulesInput?: unknown,
) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw new Error("Il nome della lega deve avere tra 2 e 40 caratteri.");
  }
  const rules = parseLeagueRules(rulesInput);

  const admin = createAdminSupabase();
  await ensureProfile(admin, userId, email);
  const season = await getCurrentSeason(admin);
  const team = await getFantasyTeam(admin, userId, season.id);
  const id = crypto.randomUUID();

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

  const rounds = await seasonRoundCount(admin, season.id);
  const rangePatch: { start_matchday: number; end_matchday?: number } = { start_matchday: 1 };
  if (rounds > 0) rangePatch.end_matchday = rounds;
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

  if (team) {
    const { error } = await admin.from("private_league_members").insert({
      private_league_id: id,
      fantasy_team_id: team.id,
    });
    if (error) throw new Error(error.message);
  }

  return { id, name: trimmed, joinCode, seasonCode: season.code, isOwner: true, isManager: true, rules, rulesStored };
}

export async function joinLeague(userId: string, email: string | undefined, code: string) {
  const joinCode = code.trim().toUpperCase();
  if (joinCode.length < 4) throw new Error("Inserisci il codice invito.");

  const admin = createAdminSupabase();
  await ensureProfile(admin, userId, email);

  const { data: league, error } = await admin
    .from("private_leagues")
    .select("id, name, join_code, season_id")
    .eq("join_code", joinCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!league) throw new Error("Nessuna lega trovata con questo codice.");

  const team = await getFantasyTeam(admin, userId, league.season_id as string);
  if (!team) {
    throw new Error("Prima crea la rosa di questa competizione: l'iscrizione usa la squadra di quella stagione.");
  }
  await assertCanJoin(admin, league.id as string, league.season_id as string);

  const { error: memberError } = await admin.from("private_league_members").insert({
    private_league_id: league.id,
    fantasy_team_id: team.id,
  });
  if (memberError && memberError.code !== "23505") {
    throw new Error(memberError.message);
  }

  return {
    id: league.id as string,
    name: league.name as string,
    joinCode: league.join_code as string,
    seasonCode: await seasonCode(admin, league.season_id as string),
    isOwner: false,
    isManager: false,
  };
}

export async function getLeagueDetail(userId: string, leagueId: string): Promise<LeagueDetail> {
  const admin = createAdminSupabase();
  const loaded = await readLeagueRow(admin, leagueId);
  if (!loaded) throw httpError("Lega non trovata.", 404);
  const { row: league, startMatchday, endMatchday, rangeReady } = loaded;

  const team = await getFantasyTeam(admin, userId, league.season_id as string);
  const roundCount = await seasonRoundCount(admin, league.season_id as string);
  const isOwner = league.owner_user_id === userId;
  const delegateIds = await delegateUserIds(admin, leagueId);
  const platformOverride = await isSuperAdmin(userId);
  const isManager = isOwner || delegateIds.includes(userId) || platformOverride;

  const { data: membership, error: membershipError } = team
    ? await admin
        .from("private_league_members")
        .select("fantasy_team_id")
        .eq("private_league_id", leagueId)
        .eq("fantasy_team_id", team.id)
        .maybeSingle()
    : { data: null, error: null };
  if (membershipError) throw new Error(membershipError.message);

  if (!isManager && !membership) throw httpError("Non fai parte di questa lega.", 403);

  const { data: memberRows, error: membersError } = await admin
    .from("private_league_members")
    .select("fantasy_team_id")
    .eq("private_league_id", leagueId);
  if (membersError) throw new Error(membersError.message);

  const teamIds = (memberRows ?? []).map((row) => row.fantasy_team_id as string);
  const { data: teams, error: teamsError } = teamIds.length
    ? await admin.from("fantasy_teams").select("id, name, user_id").in("id", teamIds)
    : { data: [], error: null };
  if (teamsError) throw new Error(teamsError.message);

  const userIds = [...new Set([...(teams ?? []).map((row) => row.user_id as string), ...delegateIds])];
  const { data: profiles, error: profilesError } = userIds.length
    ? await admin.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [], error: null };
  if (profilesError) throw new Error(profilesError.message);

  const names = new Map((profiles ?? []).map((profile) => [profile.id as string, profile.display_name as string]));
  const participants = (teams ?? []).map((row) => ({
    fantasyTeamId: row.id as string,
    userId: row.user_id as string,
    teamName: row.name as string,
    displayName: names.get(row.user_id as string) ?? "Allenatore",
  })).sort((a, b) => a.teamName.localeCompare(b.teamName, "it"));
  const delegates = delegateIds
    .filter((id) => id !== league.owner_user_id)
    .map((id) => ({
      userId: id,
      displayName: names.get(id) ?? participants.find((participant) => participant.userId === id)?.displayName ?? "Allenatore",
    }));

  return {
    id: league.id as string,
    name: league.name as string,
    joinCode: league.join_code as string,
    seasonCode: await seasonCode(admin, league.season_id as string),
    isOwner,
    isManager,
    platformOverride,
    isMember: Boolean(membership),
    delegates,
    participants,
    startMatchday,
    endMatchday,
    rangeReady,
    seasonId: league.season_id,
    roundCount,
    rules: (await readLeagueSettings(admin, league.id)).rules,
  };
}

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

export async function listPublicLeagues(userId: string): Promise<LeagueSummary[]> {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const extended = await admin
    .from("private_leagues")
    .select("id, name, join_code, settings")
    .eq("season_id", season.id);
  if (extended.error) {
    if (/settings/i.test(extended.error.message)) return [];
    throw new Error(extended.error.message);
  }
  const mine = new Set((await listLeaguesForUser(userId)).map((league) => league.id));
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
    }];
  });
}

export async function joinPublicLeague(userId: string, email: string | undefined, leagueId: string) {
  const admin = createAdminSupabase();
  await ensureProfile(admin, userId, email);
  const season = await getCurrentSeason(admin);
  const { rules, ready } = await readLeagueSettings(admin, leagueId);
  if (!ready || rules.visibility !== "public") {
    throw httpError("Questa lega non è pubblica. Serve il codice invito.", 403);
  }
  const team = await getFantasyTeam(admin, userId, season.id);
  if (!team) throw new Error("Prima crea la rosa: l'iscrizione alla lega usa la tua squadra.");
  await assertCanJoin(admin, leagueId, season.id);
  const { data: league, error } = await admin
    .from("private_leagues")
    .select("id, name, join_code")
    .eq("id", leagueId)
    .eq("season_id", season.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!league) throw httpError("Lega non trovata.", 404);
  const { error: memberError } = await admin.from("private_league_members").insert({
    private_league_id: leagueId,
    fantasy_team_id: team.id,
  });
  if (memberError && memberError.code !== "23505") throw new Error(memberError.message);
  return {
    id: league.id as string,
    name: league.name as string,
    joinCode: league.join_code as string,
    seasonCode: season.code,
    isOwner: false,
    isManager: false,
  };
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
