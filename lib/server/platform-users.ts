import type { SupabaseClient } from "@supabase/supabase-js";
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
  for (let page = 1; page <= 20; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    authUsers.push(...listed.data.users);
    if (listed.data.users.length < 200) break;
  }

  const profiles = await admin
    .from("profiles")
    .select("id, email, first_name, last_name, phone, display_name, created_at, must_reset_password");
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
    for (const row of profiles.data ?? []) byId.set(row.id as string, row);
  } else if (!missing(profiles.error.message)) {
    throw new Error(profiles.error.message);
  }

  return authUsers
    .map((user) => {
      const profile = byId.get(user.id);
      return {
        id: user.id,
        email: profile?.email || user.email || "",
        firstName: profile?.first_name ?? "",
        lastName: profile?.last_name ?? "",
        phone: profile?.phone ?? "",
        displayName: profile?.display_name ?? "",
        createdAt: profile?.created_at ?? user.created_at ?? null,
        mustResetPassword: profile?.must_reset_password === true,
      };
    })
    .sort((left, right) => left.email.localeCompare(right.email, "it"));
}

export async function requirePasswordReset(userId: string) {
  const admin = createAdminSupabase();
  const updated = await admin.from("profiles").update({ must_reset_password: true }).eq("id", userId);
  if (updated.error) {
    if (missing(updated.error.message)) throw fail("Per il reset password esegui account_controls.sql.", 409);
    throw new Error(updated.error.message);
  }
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
