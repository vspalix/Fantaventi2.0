import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRows } from "@/lib/server/read-all";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type PlatformUserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  displayName: string;
  createdAt: string | null;
  mustResetPassword: boolean;
  platformRole: "member" | "super_admin" | "unknown";
};

function fail(message: string, status: number) {
  const error = new Error(message);
  (error as Error & { status: number }).status = status;
  return error;
}

function missing(message: string) {
  return /schema cache|could not find|does not exist|column/i.test(message);
}

async function quietDelete(admin: SupabaseClient, table: string, column: string, value: string) {
  const result = await admin.from(table).delete().eq(column, value);
  if (result.error && !missing(result.error.message)) throw new Error(result.error.message);
}

export async function listPlatformUsers(): Promise<PlatformUserRow[]> {
  const admin = createAdminSupabase();
  const authUsers: { id: string; email?: string; created_at?: string }[] = [];
  // Tutte le pagine; il limite è solo un fermo di sicurezza (200.000 persone).
  for (let page = 1; page <= 1000; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    authUsers.push(...listed.data.users);
    if (listed.data.users.length < 200) break;
  }

  const profiles = await readAllRows((from, to) => admin
    .from("profiles")
    .select("id, email, first_name, last_name, phone, display_name, created_at, must_reset_password")
    .order("id")
    .range(from, to));
  const roleById = new Map<string, string>();
  let roleKnown = true;
  const roles = await readAllRows((from, to) => admin.from("profiles").select("id, platform_role").order("id").range(from, to));
  if (roles.error) {
    if (missing(roles.error.message)) roleKnown = false;
    else throw new Error(roles.error.message);
  } else {
    for (const row of roles.data) roleById.set(row.id as string, String(row.platform_role ?? "member"));
  }

  const byId = new Map<string, {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    display_name?: string | null;
    created_at?: string | null;
    must_reset_password?: boolean | null;
  }>();
  if (!profiles.error) {
    for (const row of profiles.data) byId.set(row.id as string, row);
  } else if (!missing(profiles.error.message)) {
    throw new Error(profiles.error.message);
  }

  return authUsers
    .map((user) => {
      const profile = byId.get(user.id);
      const platformRole = !roleKnown
        ? "unknown" as const
        : roleById.get(user.id) === "super_admin" ? "super_admin" as const : "member" as const;
      return {
        id: user.id,
        email: profile?.email || user.email || "",
        firstName: profile?.first_name ?? "",
        lastName: profile?.last_name ?? "",
        phone: profile?.phone ?? "",
        displayName: profile?.display_name ?? "",
        createdAt: profile?.created_at ?? user.created_at ?? null,
        mustResetPassword: profile?.must_reset_password === true,
        platformRole,
      };
    })
    .sort((left, right) => left.email.localeCompare(right.email, "it"));
}

export async function setPlatformRole(actorId: string, userId: string, role: "member" | "super_admin") {
  if (actorId === userId) throw fail("Non puoi cambiare il tuo ruolo da qui.", 409);
  const admin = createAdminSupabase();
  const updated = await admin.from("profiles").update({ platform_role: role }).eq("id", userId).select("id").maybeSingle();
  if (updated.error) {
    if (missing(updated.error.message)) throw fail("Per nominare un super admin esegui platform_access.sql.", 409);
    throw new Error(updated.error.message);
  }
  if (!updated.data) throw fail("Profilo non trovato.", 404);
}

export async function requirePasswordReset(userId: string) {
  const admin = createAdminSupabase();
  const updated = await admin.from("profiles").update({ must_reset_password: true }).eq("id", userId);
  if (updated.error) {
    if (missing(updated.error.message)) throw fail("Per il reset password esegui account_controls.sql.", 409);
    throw new Error(updated.error.message);
  }
}

/** Crea il codice per scegliere una nuova password. Non invia nessuna email. */
export async function createPasswordToken(userId: string) {
  const admin = createAdminSupabase();
  const found = await admin.auth.admin.getUserById(userId);
  if (found.error) throw new Error(found.error.message);
  const email = found.data.user?.email;
  if (!email) throw fail("Questo account non ha un'email.", 409);
  const link = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (link.error) throw new Error(link.error.message);
  return link.data.properties.hashed_token;
}

async function teamIdsOf(admin: SupabaseClient, userId: string) {
  const teams = await admin.from("fantasy_teams").select("id").eq("user_id", userId);
  if (teams.error) {
    if (missing(teams.error.message)) return [];
    throw new Error(teams.error.message);
  }
  return (teams.data ?? []).map((team) => team.id as string);
}

async function releaseOwnedLeagues(admin: SupabaseClient, userId: string, ownTeamIds: Set<string>) {
  const owned = await admin.from("private_leagues").select("id").eq("owner_user_id", userId);
  if (owned.error) {
    if (missing(owned.error.message)) return;
    throw new Error(owned.error.message);
  }
  for (const league of owned.data ?? []) {
    const leagueId = league.id as string;
    const members = await admin
      .from("private_league_members")
      .select("fantasy_team_id, fantasy_teams(user_id)")
      .eq("private_league_id", leagueId);
    const successor = (members.data ?? []).map((row) => {
      const team = Array.isArray(row.fantasy_teams) ? row.fantasy_teams[0] : row.fantasy_teams;
      return { teamId: row.fantasy_team_id as string, userId: (team as { user_id?: string } | null)?.user_id ?? "" };
    }).find((member) => member.userId && member.userId !== userId && !ownTeamIds.has(member.teamId));

    if (successor) {
      const transferred = await admin.from("private_leagues").update({ owner_user_id: successor.userId }).eq("id", leagueId);
      if (transferred.error) throw new Error(transferred.error.message);
    } else {
      await quietDelete(admin, "private_league_members", "private_league_id", leagueId);
      await quietDelete(admin, "private_leagues", "id", leagueId);
    }
  }
}

async function deleteTeam(admin: SupabaseClient, teamId: string) {
  const lineups = await admin.from("lineups").select("id").eq("fantasy_team_id", teamId);
  const lineupIds = (lineups.data ?? []).map((row) => row.id as string);
  if (lineupIds.length > 0) {
    const slots = await admin.from("lineup_slots").delete().in("lineup_id", lineupIds);
    if (slots.error && !missing(slots.error.message)) throw new Error(slots.error.message);
  }
  for (const table of ["lineup_player_scores", "team_gameweek_scores", "lineups", "roster_stints", "checkpoint_moves", "roster_checkpoint_uses", "private_league_members"]) {
    await quietDelete(admin, table, table === "private_league_members" ? "fantasy_team_id" : "fantasy_team_id", teamId);
  }
  await quietDelete(admin, "fantasy_teams", "id", teamId);
}

export async function deletePlatformUser(userId: string) {
  const admin = createAdminSupabase();
  const teamIds = await teamIdsOf(admin, userId);
  await releaseOwnedLeagues(admin, userId, new Set(teamIds));
  for (const teamId of teamIds) {
    const memberships = await admin.from("private_league_members").delete().eq("fantasy_team_id", teamId);
    if (memberships.error && !missing(memberships.error.message)) throw new Error(memberships.error.message);
    await deleteTeam(admin, teamId);
  }
  const removed = await admin.auth.admin.deleteUser(userId);
  if (removed.error) throw new Error(removed.error.message);
}

export async function deleteOwnAccount(userId: string) {
  const admin = createAdminSupabase();
  const owned = await admin.from("private_leagues").select("id, name").eq("owner_user_id", userId);
  if (owned.error && !missing(owned.error.message)) throw new Error(owned.error.message);

  const blocked: string[] = [];
  const solo: string[] = [];
  for (const league of owned.data ?? []) {
    const leagueId = league.id as string;
    const members = await admin
      .from("private_league_members")
      .select("fantasy_team_id, fantasy_teams(user_id)")
      .eq("private_league_id", leagueId);
    if (members.error && !missing(members.error.message)) throw new Error(members.error.message);
    const others = (members.data ?? []).some((row) => {
      const team = Array.isArray(row.fantasy_teams) ? row.fantasy_teams[0] : row.fantasy_teams;
      const owner = (team as { user_id?: string } | null)?.user_id ?? "";
      return Boolean(owner) && owner !== userId;
    });
    if (others) blocked.push(String(league.name));
    else solo.push(leagueId);
  }
  if (blocked.length > 0) {
    const names = blocked.map((name) => `«${name}»`).join(", ");
    throw fail(`Sei presidente di ${names}. Trasferisci il ruolo di presidente o sciogli la lega prima di eliminare l'account.`, 409);
  }

  for (const leagueId of solo) {
    for (const table of ["league_delegates", "league_regulations", "league_feed", "league_badges", "live_rank_snapshots", "private_league_members"]) {
      await quietDelete(admin, table, table === "private_league_members" ? "private_league_id" : "league_id", leagueId);
    }
    await quietDelete(admin, "private_leagues", "id", leagueId);
  }

  const clearedGrant = await admin.from("league_delegates").update({ granted_by: null }).eq("granted_by", userId);
  if (clearedGrant.error && !missing(clearedGrant.error.message)) throw new Error(clearedGrant.error.message);
  await quietDelete(admin, "league_delegates", "user_id", userId);
  const clearedRegulation = await admin.from("league_regulations").update({ updated_by: null }).eq("updated_by", userId);
  if (clearedRegulation.error && !missing(clearedRegulation.error.message)) throw new Error(clearedRegulation.error.message);

  for (const teamId of await teamIdsOf(admin, userId)) await deleteTeam(admin, teamId);
  await quietDelete(admin, "user_notices", "user_id", userId);
  await quietDelete(admin, "push_subscriptions", "user_id", userId);
  await quietDelete(admin, "device_push_tokens", "user_id", userId);
  await quietDelete(admin, "admin_audit_logs", "admin_id", userId);

  const anonymized = await admin.from("profiles").update({
    email: null,
    first_name: null,
    last_name: null,
    phone: null,
    display_name: "Account eliminato",
  }).eq("id", userId);
  if (anonymized.error && !missing(anonymized.error.message)) throw new Error(anonymized.error.message);

  const removed = await admin.auth.admin.deleteUser(userId);
  if (removed.error) throw new Error(removed.error.message);
}
