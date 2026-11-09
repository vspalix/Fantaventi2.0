import { alphabeticalOfficeLineup } from "@/lib/formations";
import { officeLineupMode } from "@/lib/league-rules";
import { readLeagueSettings } from "@/lib/server/league-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

type SlotCopy = {
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
  is_starter?: boolean;
  slot_order?: number;
};

export async function fileForgottenLineups(gameweekId: string, onlyTeamIds?: string[]) {
  const admin = createAdminSupabase();
  const week = await admin.from("gameweeks").select("id, number, season_id").eq("id", gameweekId).maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) return 0;
  const seasonId = week.data.season_id as string;
  const number = Number(week.data.number);

  const teams = await admin.from("fantasy_teams").select("id").eq("season_id", seasonId);
  if (teams.error) throw new Error(teams.error.message);
  const allowed = onlyTeamIds ? new Set(onlyTeamIds) : null;
  const teamIds = (teams.data ?? []).map((row) => row.id as string).filter((id) => !allowed || allowed.has(id));
  if (teamIds.length === 0) return 0;

  const existing = await admin.from("lineups").select("fantasy_team_id").eq("gameweek_id", gameweekId).in("fantasy_team_id", teamIds);
  if (existing.error) throw new Error(existing.error.message);
  const filed = new Set((existing.data ?? []).map((row) => row.fantasy_team_id as string));
  const missing = teamIds.filter((teamId) => !filed.has(teamId));
  if (missing.length === 0) return 0;

  const memberships = await admin
    .from("private_league_members")
    .select("fantasy_team_id, private_league_id")
    .in("fantasy_team_id", missing);
  if (memberships.error) throw new Error(memberships.error.message);
  const leagueIds = [...new Set((memberships.data ?? []).map((row) => row.private_league_id as string))];
  const modeByLeague = new Map<string, "carry" | "penalty">();
  for (const leagueId of leagueIds) {
    const settings = await readLeagueSettings(admin, leagueId);
    modeByLeague.set(leagueId, settings.rules.missedLineup);
  }
  const leaguesByTeam = new Map<string, string[]>();
  for (const row of memberships.data ?? []) {
    const teamId = row.fantasy_team_id as string;
    const list = leaguesByTeam.get(teamId) ?? [];
    list.push(row.private_league_id as string);
    leaguesByTeam.set(teamId, list);
  }

  const earlier = await admin
    .from("gameweeks")
    .select("id, number")
    .eq("season_id", seasonId)
    .lt("number", number);
  if (earlier.error) throw new Error(earlier.error.message);
  const numberByWeek = new Map((earlier.data ?? []).map((row) => [row.id as string, Number(row.number)]));
  const earlierIds = [...numberByWeek.keys()];
  const previous = earlierIds.length === 0
    ? { data: [], error: null }
    : await admin.from("lineups").select("id, fantasy_team_id, gameweek_id").in("fantasy_team_id", missing).in("gameweek_id", earlierIds);
  if (previous.error) throw new Error(previous.error.message);

  let filedCount = 0;
  for (const teamId of missing) {
    const modes = (leaguesByTeam.get(teamId) ?? []).map((leagueId) => modeByLeague.get(leagueId) ?? "carry");
    if (modes.length === 0 || officeLineupMode(modes) === "penalty") continue;
    const source = (previous.data ?? [])
      .filter((row) => row.fantasy_team_id === teamId)
      .sort((left, right) => (numberByWeek.get(right.gameweek_id as string) ?? 0) - (numberByWeek.get(left.gameweek_id as string) ?? 0))[0];
    const slots = source
      ? await slotsOf(source.id as string)
      : await alphabeticalSlots(seasonId, number, teamId);
    if (slots.length === 0) continue;
    const copied = await copyLineup(teamId, gameweekId, slots);
    if (copied) filedCount += 1;
  }
  return filedCount;
}

async function slotsOf(lineupId: string): Promise<SlotCopy[]> {
  const admin = createAdminSupabase();
  const slots = await admin
    .from("lineup_slots")
    .select("player_id, is_captain, is_vice_captain, is_starter, slot_order")
    .eq("lineup_id", lineupId);
  const plain = slots.error && /is_starter|slot_order/i.test(slots.error.message)
    ? await admin.from("lineup_slots").select("player_id, is_captain, is_vice_captain").eq("lineup_id", lineupId)
    : slots;
  if (plain.error) throw new Error(plain.error.message);
  return (plain.data ?? []) as SlotCopy[];
}

async function alphabeticalSlots(seasonId: string, gameweek: number, teamId: string): Promise<SlotCopy[]> {
  const admin = createAdminSupabase();
  const stints = await admin
    .from("roster_stints")
    .select("player_id, active_from_gameweek, active_until_gameweek")
    .eq("fantasy_team_id", teamId);
  if (stints.error) throw new Error(stints.error.message);
  const playerIds = (stints.data ?? [])
    .filter((stint) => {
      const from = Number(stint.active_from_gameweek);
      const until = stint.active_until_gameweek == null ? null : Number(stint.active_until_gameweek);
      return from <= gameweek && (until === null || until >= gameweek);
    })
    .map((stint) => stint.player_id as string);
  if (playerIds.length === 0) return [];
  const people = await admin.from("players").select("id, full_name").in("id", playerIds);
  if (people.error) throw new Error(people.error.message);
  const registrations = await admin
    .from("player_registrations")
    .select("player_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId)
    .in("player_id", playerIds);
  if (registrations.error) throw new Error(registrations.error.message);
  const roleOf = new Map<string, PlayerRole>();
  for (const row of registrations.data ?? []) {
    const from = Number(row.effective_from_gameweek);
    const until = row.effective_to_gameweek == null ? null : Number(row.effective_to_gameweek);
    if (from > gameweek || (until !== null && until < gameweek)) continue;
    roleOf.set(row.player_id as string, row.role as PlayerRole);
  }
  const names = new Map((people.data ?? []).map((row) => [row.id as string, row.full_name as string]));
  const roster = playerIds.flatMap((playerId) => {
    const role = roleOf.get(playerId);
    if (!role) return [];
    return [{ id: playerId, role, name: names.get(playerId) ?? "" }];
  });
  const picked = alphabeticalOfficeLineup(roster);
  if (!picked) return [];
  const starters = picked.starterIds.map((playerId, index) => ({
    player_id: playerId,
    is_captain: playerId === picked.captainId,
    is_vice_captain: playerId === picked.viceId,
    is_starter: true,
    slot_order: index + 1,
  }));
  const bench = picked.benchIds.map((playerId, index) => ({
    player_id: playerId,
    is_captain: false,
    is_vice_captain: false,
    is_starter: false,
    slot_order: index + 1,
  }));
  return [...starters, ...bench];
}

async function copyLineup(teamId: string, gameweekId: string, slots: SlotCopy[]) {
  const admin = createAdminSupabase();
  const withOrigin = await admin.from("lineups").insert({
    fantasy_team_id: teamId,
    gameweek_id: gameweekId,
    status: "locked",
    origin: "office",
    saved_at: new Date().toISOString(),
  }).select("id").maybeSingle();
  const created = withOrigin.error && /origin|saved_at|schema cache|could not find/i.test(withOrigin.error.message)
    ? await admin.from("lineups").insert({
      fantasy_team_id: teamId,
      gameweek_id: gameweekId,
      status: "locked",
    }).select("id").maybeSingle()
    : withOrigin;
  if (created.error) throw new Error(created.error.message);
  const lineupId = created.data?.id as string | undefined;
  if (!lineupId || slots.length === 0) return Boolean(lineupId);
  const rows = slots.map((slot) => ({
    lineup_id: lineupId,
    player_id: slot.player_id,
    is_captain: Boolean(slot.is_captain),
    is_vice_captain: Boolean(slot.is_vice_captain),
    is_starter: slot.is_starter !== false,
    slot_order: Number(slot.slot_order ?? 0),
  }));
  const inserted = await admin.from("lineup_slots").insert(rows);
  if (inserted.error && /is_starter|slot_order/i.test(inserted.error.message)) {
    const retry = await admin.from("lineup_slots").insert(rows.map((row) => ({
      lineup_id: row.lineup_id,
      player_id: row.player_id,
      is_captain: row.is_captain,
      is_vice_captain: row.is_vice_captain,
    })));
    if (retry.error) throw new Error(retry.error.message);
    return true;
  }
  if (inserted.error) throw new Error(inserted.error.message);
  return true;
}
