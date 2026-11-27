import { randomUUID } from "node:crypto";
import { alphabeticalOfficeLineup, carryLineup, type CarriedLineup } from "@/lib/formations";
import { officeLineupMode } from "@/lib/league-rules";
import { readLeagueSettings } from "@/lib/server/league-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

type RosterRow = { id: string; role: PlayerRole; name: string };

export type OfficeSlot = {
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
  is_starter?: boolean;
  slot_order?: number;
};

type RegistrationRow = {
  player_id: string;
  role: PlayerRole;
  effective_from_gameweek: number;
  effective_to_gameweek: number | null;
};

/**
 * Le formazioni d'ufficio che il calcolo della giornata registrerebbe adesso, senza scrivere niente.
 * Solo per le squadre senza formazione e con almeno una lega che riporta l'ultima formazione:
 * se tutte le sue leghe danno la penalità, la squadra non ne riceve una.
 * La stessa funzione serve al calcolo ufficiale (che poi le salva) e alle schermate live (che le mostrano).
 */
export async function planForgottenLineups(gameweekId: string, onlyTeamIds?: string[]) {
  const plans = new Map<string, OfficeSlot[]>();
  const admin = createAdminSupabase();
  const week = await admin.from("gameweeks").select("id, number, season_id").eq("id", gameweekId).maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) return plans;
  const seasonId = week.data.season_id as string;
  const number = Number(week.data.number);

  const teams = await admin.from("fantasy_teams").select("id").eq("season_id", seasonId);
  if (teams.error) throw new Error(teams.error.message);
  const allowed = onlyTeamIds ? new Set(onlyTeamIds) : null;
  const teamIds = (teams.data ?? []).map((row) => row.id as string).filter((id) => !allowed || allowed.has(id));
  if (teamIds.length === 0) return plans;

  const existing = await admin.from("lineups").select("fantasy_team_id").eq("gameweek_id", gameweekId).in("fantasy_team_id", teamIds);
  if (existing.error) throw new Error(existing.error.message);
  const filed = new Set((existing.data ?? []).map((row) => row.fantasy_team_id as string));
  const missing = teamIds.filter((teamId) => !filed.has(teamId));
  if (missing.length === 0) return plans;

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
  const eligible = missing.filter((teamId) => {
    const modes = (leaguesByTeam.get(teamId) ?? []).map((leagueId) => modeByLeague.get(leagueId) ?? "carry");
    return modes.length > 0 && officeLineupMode(modes) === "carry";
  });
  if (eligible.length === 0) return plans;

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
    : await admin.from("lineups").select("id, fantasy_team_id, gameweek_id").in("fantasy_team_id", eligible).in("gameweek_id", earlierIds);
  if (previous.error) throw new Error(previous.error.message);
  const sourceByTeam = new Map<string, string>();
  for (const teamId of eligible) {
    const source = (previous.data ?? [])
      .filter((row) => row.fantasy_team_id === teamId)
      .sort((left, right) => (numberByWeek.get(right.gameweek_id as string) ?? 0) - (numberByWeek.get(left.gameweek_id as string) ?? 0))[0];
    if (source) sourceByTeam.set(teamId, source.id as string);
  }

  const [slotsByLineup, stintsByTeam] = await Promise.all([
    slotsOfLineups([...sourceByTeam.values()]),
    activeStints(eligible, number),
  ]);
  const rosterIds = [...new Set([...stintsByTeam.values()].flat())];
  const slotIds = [...new Set([...slotsByLineup.values()].flat().map((slot) => slot.player_id))];
  const [names, registrations] = await Promise.all([
    playerNames(rosterIds),
    registrationsOf(seasonId, [...new Set([...rosterIds, ...slotIds])]),
  ]);

  for (const teamId of eligible) {
    const roster = rosterOf(stintsByTeam.get(teamId) ?? [], number, names, registrations);
    const sourceId = sourceByTeam.get(teamId);
    const carried = sourceId ? carriedSlots(number, roster, slotsByLineup.get(sourceId) ?? [], registrations) : null;
    const slots = carried ?? alphabeticalSlots(roster);
    if (slots.length > 0) plans.set(teamId, slots);
  }
  return plans;
}

/** Registra le formazioni d'ufficio mancanti. Una sola per squadra e giornata, anche con due giri insieme. */
export async function fileForgottenLineups(gameweekId: string, onlyTeamIds?: string[]) {
  const plans = await planForgottenLineups(gameweekId, onlyTeamIds);
  let filedCount = 0;
  for (const [teamId, slots] of plans) {
    const copied = await copyLineup(teamId, gameweekId, slots);
    if (copied) filedCount += 1;
  }
  return filedCount;
}

async function slotsOfLineups(lineupIds: string[]) {
  const byLineup = new Map<string, OfficeSlot[]>();
  if (lineupIds.length === 0) return byLineup;
  const admin = createAdminSupabase();
  const slots = await admin
    .from("lineup_slots")
    .select("lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order")
    .in("lineup_id", lineupIds);
  const plain = slots.error && /is_starter|slot_order/i.test(slots.error.message)
    ? await admin.from("lineup_slots").select("lineup_id, player_id, is_captain, is_vice_captain").in("lineup_id", lineupIds)
    : slots;
  if (plain.error) throw new Error(plain.error.message);
  for (const row of (plain.data ?? []) as (OfficeSlot & { lineup_id: string })[]) {
    const list = byLineup.get(row.lineup_id) ?? [];
    list.push({
      player_id: row.player_id,
      is_captain: Boolean(row.is_captain),
      is_vice_captain: Boolean(row.is_vice_captain),
      is_starter: row.is_starter,
      slot_order: row.slot_order,
    });
    byLineup.set(row.lineup_id, list);
  }
  return byLineup;
}

async function activeStints(teamIds: string[], gameweek: number) {
  const stints = await createAdminSupabase()
    .from("roster_stints")
    .select("fantasy_team_id, player_id, active_from_gameweek, active_until_gameweek")
    .in("fantasy_team_id", teamIds);
  if (stints.error) throw new Error(stints.error.message);
  const byTeam = new Map<string, string[]>();
  for (const stint of stints.data ?? []) {
    const from = Number(stint.active_from_gameweek);
    const until = stint.active_until_gameweek == null ? null : Number(stint.active_until_gameweek);
    if (from > gameweek || (until !== null && until < gameweek)) continue;
    const list = byTeam.get(stint.fantasy_team_id as string) ?? [];
    list.push(stint.player_id as string);
    byTeam.set(stint.fantasy_team_id as string, list);
  }
  return byTeam;
}

async function playerNames(playerIds: string[]) {
  if (playerIds.length === 0) return new Map<string, string>();
  const people = await createAdminSupabase().from("players").select("id, full_name").in("id", playerIds);
  if (people.error) throw new Error(people.error.message);
  return new Map((people.data ?? []).map((row) => [row.id as string, row.full_name as string]));
}

async function registrationsOf(seasonId: string, playerIds: string[]): Promise<RegistrationRow[]> {
  if (playerIds.length === 0) return [];
  const registrations = await createAdminSupabase()
    .from("player_registrations")
    .select("player_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId)
    .in("player_id", playerIds)
    .order("effective_from_gameweek", { ascending: true });
  if (registrations.error) throw new Error(registrations.error.message);
  return (registrations.data ?? []).map((row) => ({
    player_id: row.player_id as string,
    role: row.role as PlayerRole,
    effective_from_gameweek: Number(row.effective_from_gameweek),
    effective_to_gameweek: row.effective_to_gameweek == null ? null : Number(row.effective_to_gameweek),
  }));
}

/** La rosa della giornata: chi è in rosa e ha un ruolo valido in quella giornata. */
function rosterOf(
  playerIds: string[],
  gameweek: number,
  names: ReadonlyMap<string, string>,
  registrations: RegistrationRow[],
): RosterRow[] {
  const wanted = new Set(playerIds);
  const roleOf = new Map<string, PlayerRole>();
  for (const row of registrations) {
    if (!wanted.has(row.player_id)) continue;
    const until = row.effective_to_gameweek;
    if (row.effective_from_gameweek > gameweek || (until !== null && until < gameweek)) continue;
    roleOf.set(row.player_id, row.role);
  }
  return playerIds.flatMap((playerId) => {
    const role = roleOf.get(playerId);
    if (!role) return [];
    return [{ id: playerId, role, name: names.get(playerId) ?? "" }];
  });
}

/** L'ultima formazione, riportata sui calciatori che sono in rosa in questa giornata. */
function carriedSlots(
  gameweek: number,
  roster: RosterRow[],
  sourceSlots: OfficeSlot[],
  registrations: RegistrationRow[],
): OfficeSlot[] | null {
  const ordered = [...sourceSlots].sort((left, right) => Number(left.slot_order ?? 0) - Number(right.slot_order ?? 0));
  const previous: CarriedLineup = {
    playerIds: ordered.filter((slot) => slot.is_starter !== false).map((slot) => slot.player_id),
    benchIds: ordered.filter((slot) => slot.is_starter === false).map((slot) => slot.player_id),
    captainId: ordered.find((slot) => slot.is_captain)?.player_id ?? null,
    viceId: ordered.find((slot) => slot.is_vice_captain)?.player_id ?? null,
  };
  const present = new Set(roster.map((player) => player.id));
  const gone = new Set(ordered.map((slot) => slot.player_id).filter((id) => !present.has(id)));
  const formerRoles = new Map<string, PlayerRole>();
  for (const row of registrations) {
    // Chi è uscito dal listone tiene l'ultimo ruolo avuto fino a questa giornata.
    if (!gone.has(row.player_id) || row.effective_from_gameweek > gameweek) continue;
    formerRoles.set(row.player_id, row.role);
  }
  const picked = carryLineup(roster, previous, formerRoles);
  return picked ? toSlots(picked.playerIds, picked.benchIds, picked.captainId, picked.viceId) : null;
}

function toSlots(starterIds: string[], benchIds: string[], captainId: string | null, viceId: string | null): OfficeSlot[] {
  const slot = (playerId: string, index: number, starter: boolean) => ({
    player_id: playerId,
    is_captain: starter && playerId === captainId,
    is_vice_captain: starter && playerId === viceId,
    is_starter: starter,
    slot_order: index + 1,
  });
  return [
    ...starterIds.map((playerId, index) => slot(playerId, index, true)),
    ...benchIds.map((playerId, index) => slot(playerId, index, false)),
  ];
}

function alphabeticalSlots(roster: RosterRow[]): OfficeSlot[] {
  const picked = alphabeticalOfficeLineup(roster);
  return picked ? toSlots(picked.starterIds, picked.benchIds, picked.captainId, picked.viceId) : [];
}

/** Il vincolo «una formazione per squadra e giornata» ha fermato un secondo inserimento. */
function alreadyFiled(error: { code?: string; message: string }) {
  return error.code === "23505" || /lineups_fantasy_team_id_gameweek_id_key|duplicate key/i.test(error.message);
}

async function copyLineup(teamId: string, gameweekId: string, slots: OfficeSlot[]) {
  const admin = createAdminSupabase();
  const withOrigin = await admin.from("lineups").insert({
    id: randomUUID(),
    fantasy_team_id: teamId,
    gameweek_id: gameweekId,
    status: "locked",
    origin: "office",
    saved_at: new Date().toISOString(),
  }).select("id").maybeSingle();
  const created = withOrigin.error && /origin|saved_at|schema cache|could not find/i.test(withOrigin.error.message)
    ? await admin.from("lineups").insert({
      id: randomUUID(),
      fantasy_team_id: teamId,
      gameweek_id: gameweekId,
      status: "locked",
    }).select("id").maybeSingle()
    : withOrigin;
  // Un altro giro l'ha appena registrata: resta quella e non se ne crea una seconda.
  if (created.error && alreadyFiled(created.error)) return false;
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
