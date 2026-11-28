import { randomUUID } from "node:crypto";
import { alphabeticalOfficeLineup, carryLineup, type CarriedLineup } from "@/lib/formations";
import { inLeagueRange, officeLineupMode } from "@/lib/league-rules";
import { reportError } from "@/lib/server/error-report";
import { readManyLeagueSettings } from "@/lib/server/league-settings";
import { inChunks, readAllChunks, readAllRows } from "@/lib/server/read-all";
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

  const wanted = onlyTeamIds ? [...new Set(onlyTeamIds)] : null;
  const seasonTeams = () => admin.from("fantasy_teams").select("id").eq("season_id", seasonId);
  const teams = wanted
    ? await readAllChunks(wanted, (ids, from, to) => seasonTeams().in("id", ids).order("id").range(from, to))
    : await readAllRows((from, to) => seasonTeams().order("id").range(from, to));
  if (teams.error) throw new Error(teams.error.message);
  const teamIds = teams.data.map((row) => row.id as string);
  if (teamIds.length === 0) return plans;

  const filedWeek = () => admin.from("lineups").select("fantasy_team_id").eq("gameweek_id", gameweekId);
  const existing = wanted
    ? await readAllChunks(teamIds, (ids, from, to) => filedWeek().in("fantasy_team_id", ids).order("id").range(from, to))
    : await readAllRows((from, to) => filedWeek().order("id").range(from, to));
  if (existing.error) throw new Error(existing.error.message);
  const filed = new Set(existing.data.map((row) => row.fantasy_team_id as string));
  const missing = teamIds.filter((teamId) => !filed.has(teamId));
  if (missing.length === 0) return plans;

  const memberships = await readAllChunks(missing, (ids, from, to) => admin
    .from("private_league_members")
    .select("fantasy_team_id, private_league_id")
    .in("fantasy_team_id", ids)
    .order("private_league_id")
    .order("fantasy_team_id")
    .range(from, to));
  if (memberships.error) throw new Error(memberships.error.message);
  const leagueIds = [...new Set(memberships.data.map((row) => row.private_league_id as string))];
  const modeByLeague = new Map<string, "carry" | "penalty">();
  for (const [leagueId, settings] of await readManyLeagueSettings(admin, leagueIds)) {
    // Una lega conta solo le sue giornate: ricalcolarne un'altra non le crea formazioni.
    if (inLeagueRange(settings.range, number)) modeByLeague.set(leagueId, settings.rules.missedLineup);
  }
  const leaguesByTeam = new Map<string, string[]>();
  for (const row of memberships.data) {
    const teamId = row.fantasy_team_id as string;
    const list = leaguesByTeam.get(teamId) ?? [];
    list.push(row.private_league_id as string);
    leaguesByTeam.set(teamId, list);
  }
  const eligible = missing.filter((teamId) => {
    const modes = (leaguesByTeam.get(teamId) ?? []).flatMap((leagueId) => modeByLeague.get(leagueId) ?? []);
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
    : await readAllChunks(eligible, (ids, from, to) => admin
      .from("lineups")
      .select("id, fantasy_team_id, gameweek_id")
      .in("fantasy_team_id", ids)
      .in("gameweek_id", earlierIds)
      .order("id")
      .range(from, to));
  if (previous.error) throw new Error(previous.error.message);
  // La formazione più recente di ogni squadra.
  const latest = new Map<string, { id: string; number: number }>();
  for (const row of previous.data) {
    const teamId = row.fantasy_team_id as string;
    const rowNumber = numberByWeek.get(row.gameweek_id as string) ?? 0;
    if (rowNumber > (latest.get(teamId)?.number ?? -1)) latest.set(teamId, { id: row.id as string, number: rowNumber });
  }
  const sourceByTeam = new Map([...latest].map(([teamId, source]) => [teamId, source.id]));

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

  // Per ogni squadra bastano i dati dei suoi calciatori: scorrere tutto ogni volta costa troppo.
  const registrationsByPlayer = new Map<string, RegistrationRow[]>();
  for (const row of registrations) {
    const list = registrationsByPlayer.get(row.player_id) ?? [];
    list.push(row);
    registrationsByPlayer.set(row.player_id, list);
  }
  for (const teamId of eligible) {
    const stints = stintsByTeam.get(teamId) ?? [];
    const sourceId = sourceByTeam.get(teamId);
    const sourceSlots = sourceId ? slotsByLineup.get(sourceId) ?? [] : [];
    const own = [...new Set([...stints, ...sourceSlots.map((slot) => slot.player_id)])]
      .flatMap((playerId) => registrationsByPlayer.get(playerId) ?? []);
    const roster = rosterOf(stints, number, names, own);
    const carried = sourceId ? carriedSlots(number, roster, sourceSlots, own) : null;
    const slots = carried ?? alphabeticalSlots(roster);
    if (slots.length > 0) plans.set(teamId, slots);
  }
  return plans;
}

/** Quante formazioni d'ufficio si registrano insieme. */
const FILE_BATCH = 200;

/** Registra le formazioni d'ufficio mancanti. Una sola per squadra e giornata, anche con due giri insieme. */
export async function fileForgottenLineups(gameweekId: string, onlyTeamIds?: string[]) {
  const plans = await planForgottenLineups(gameweekId, onlyTeamIds);
  let filedCount = 0;
  // Sempre nello stesso ordine: due giri insieme non si bloccano a vicenda sulle squadre.
  for (const batch of inChunks([...plans].sort(([left], [right]) => left.localeCompare(right)), FILE_BATCH)) {
    filedCount += await copyLineups(gameweekId, batch);
  }
  return filedCount;
}

async function slotsOfLineups(lineupIds: string[]) {
  const byLineup = new Map<string, OfficeSlot[]>();
  if (lineupIds.length === 0) return byLineup;
  const admin = createAdminSupabase();
  const read = (columns: string) => readAllChunks<OfficeSlot & { lineup_id: string }>(lineupIds, (ids, from, to) => admin
    .from("lineup_slots")
    .select(columns)
    .in("lineup_id", ids)
    .order("lineup_id")
    .order("player_id")
    .range(from, to)
    .returns<(OfficeSlot & { lineup_id: string })[]>());
  const slots = await read("lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order");
  const plain = slots.error && /is_starter|slot_order/i.test(slots.error.message)
    ? await read("lineup_id, player_id, is_captain, is_vice_captain")
    : slots;
  if (plain.error) throw new Error(plain.error.message);
  for (const row of plain.data) {
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
  const admin = createAdminSupabase();
  const stints = await readAllChunks(teamIds, (ids, from, to) => admin
    .from("roster_stints")
    .select("fantasy_team_id, player_id, active_from_gameweek, active_until_gameweek")
    .in("fantasy_team_id", ids)
    .order("id")
    .range(from, to));
  if (stints.error) throw new Error(stints.error.message);
  const byTeam = new Map<string, string[]>();
  for (const stint of stints.data) {
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
  const admin = createAdminSupabase();
  const people = await readAllChunks(playerIds, (ids, from, to) => admin
    .from("players")
    .select("id, full_name")
    .in("id", ids)
    .order("id")
    .range(from, to));
  if (people.error) throw new Error(people.error.message);
  return new Map(people.data.map((row) => [row.id as string, row.full_name as string]));
}

async function registrationsOf(seasonId: string, playerIds: string[]): Promise<RegistrationRow[]> {
  const admin = createAdminSupabase();
  // Le righe di un calciatore stanno nello stesso blocco: l'ordine per giornata resta valido.
  const registrations = await readAllChunks(playerIds, (ids, from, to) => admin
    .from("player_registrations")
    .select("player_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId)
    .in("player_id", ids)
    .order("effective_from_gameweek", { ascending: true })
    .order("id")
    .range(from, to));
  if (registrations.error) throw new Error(registrations.error.message);
  return registrations.data.map((row) => ({
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

/**
 * Registra un blocco di formazioni. Il vincolo «una formazione per squadra e giornata» lascia fuori
 * quelle che un altro giro (o il giocatore) ha già registrato: le loro non si toccano.
 */
async function copyLineups(gameweekId: string, batch: [string, OfficeSlot[]][]) {
  const admin = createAdminSupabase();
  const savedAt = new Date().toISOString();
  const rows = batch.map(([teamId]) => ({
    id: randomUUID(),
    fantasy_team_id: teamId,
    gameweek_id: gameweekId,
    status: "locked",
    origin: "office",
    saved_at: savedAt,
  }));
  const insert = (list: Record<string, unknown>[]) => admin
    .from("lineups")
    .upsert(list, { onConflict: "fantasy_team_id,gameweek_id", ignoreDuplicates: true })
    .select("id, fantasy_team_id");
  const withOrigin = await insert(rows);
  const created = withOrigin.error && /origin|saved_at|schema cache|could not find/i.test(withOrigin.error.message)
    ? await insert(rows.map(({ id, fantasy_team_id, gameweek_id, status }) => ({ id, fantasy_team_id, gameweek_id, status })))
    : withOrigin;
  if (created.error) throw new Error(created.error.message);
  const slotsByTeam = new Map(batch);
  const lineups = (created.data ?? []).map((row) => ({ id: row.id as string, teamId: row.fantasy_team_id as string }));
  const slots = lineups.flatMap((lineup) => (slotsByTeam.get(lineup.teamId) ?? []).map((slot) => ({
    lineup_id: lineup.id,
    player_id: slot.player_id,
    is_captain: Boolean(slot.is_captain),
    is_vice_captain: Boolean(slot.is_vice_captain),
    is_starter: slot.is_starter !== false,
    slot_order: Number(slot.slot_order ?? 0),
  })));
  if (slots.length === 0) return lineups.length;
  let inserted = await admin.from("lineup_slots").insert(slots);
  if (inserted.error && /is_starter|slot_order/i.test(inserted.error.message)) {
    inserted = await admin.from("lineup_slots").insert(slots.map(({ lineup_id, player_id, is_captain, is_vice_captain }) => ({
      lineup_id, player_id, is_captain, is_vice_captain,
    })));
  }
  if (inserted.error) {
    // Senza calciatori resterebbero formazioni vuote che il giro dopo crederebbe consegnate: si tolgono.
    for (const part of inChunks(lineups.map((lineup) => lineup.id))) {
      const removed = await admin.from("lineups").delete().in("id", part);
      if (removed.error) void reportError("Formazioni d'ufficio: righe vuote non eliminate", new Error(removed.error.message));
    }
    throw new Error(inserted.error.message);
  }
  return lineups.length;
}
