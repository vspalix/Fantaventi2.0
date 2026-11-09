import { randomUUID } from "node:crypto";
import {
  GAMEWEEK_STATUSES,
  TEST_TEAM_PASSWORD,
  type GameweekStatus,
  type GeneratedTestTeam,
  type AdminFiledLineup,
  type LateJoinReport,
  type TestLabSnapshot,
  type TestLeagueOption,
} from "@/lib/admin-types";
import { evaluateRoster } from "@/lib/constraints";
import { FORMATIONS, autoLineup, formationIssue } from "@/lib/formations";
import { ensureProfile, getCurrentSeason, getFantasyTeam, loadCatalog } from "@/lib/server/catalog";
import { activateSeasonGameweek } from "@/lib/server/gameweek-cycle";
import { loadLeagueHub } from "@/lib/server/league-hub";
import { getLeagueDetail } from "@/lib/server/leagues";
import { simulateLeagueGameweek } from "@/lib/server/simulate-gameweek";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { CatalogPlayer, ClubRef, PlayerRole } from "@/lib/types";

const TEST_BATCH = 5;
const ROLES: PlayerRole[] = ["GK", "DEF", "MID", "FWD"];

function matchday(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function isGameweekStatus(value: string): value is GameweekStatus {
  return (GAMEWEEK_STATUSES as readonly string[]).includes(value);
}

async function ownedLeagues(
  admin: ReturnType<typeof createAdminSupabase>,
  userId: string,
  seasonId: string,
): Promise<TestLeagueOption[]> {
  const withRange = await admin
    .from("private_leagues")
    .select("id, name, start_matchday, end_matchday")
    .eq("owner_user_id", userId)
    .eq("season_id", seasonId)
    .order("name");

  if (!withRange.error) {
    return (withRange.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      startMatchday: matchday(row.start_matchday, 1),
      endMatchday: matchday(row.end_matchday, 38),
    }));
  }

  if (!/start_matchday|end_matchday/i.test(withRange.error.message)) {
    throw new Error(withRange.error.message);
  }

  const plain = await admin
    .from("private_leagues")
    .select("id, name")
    .eq("owner_user_id", userId)
    .eq("season_id", seasonId)
    .order("name");
  if (plain.error) throw new Error(plain.error.message);
  return (plain.data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    startMatchday: 1,
    endMatchday: 38,
  }));
}

export async function loadTestLab(userId: string): Promise<TestLabSnapshot> {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const leagues = await ownedLeagues(admin, userId, season.id);
  const { data, error } = await admin
    .from("gameweeks")
    .select("id, number, status, deadline_at")
    .eq("season_id", season.id)
    .order("number", { ascending: true });
  if (error) throw new Error(error.message);

  return {
    seasonCode: `${season.competitionName} ${season.code}`,
    leagues,
    gameweeks: (data ?? []).map((row) => ({
      id: row.id as string,
      number: row.number as number,
      status: row.status as GameweekStatus,
      deadlineAt: row.deadline_at as string,
    })),
  };
}

async function requireOwnedLeague(userId: string, leagueId: string) {
  const league = await getLeagueDetail(userId, leagueId);
  if (!league.isOwner) throw httpError("Solo chi ha creato la lega può usare il laboratorio di test.", 403);
  return league;
}

async function findOrCreateTestUser(
  admin: ReturnType<typeof createAdminSupabase>,
  email: string,
) {
  const created = await admin.auth.admin.createUser({
    email,
    password: TEST_TEAM_PASSWORD,
    email_confirm: true,
  });
  if (!created.error && created.data.user) return created.data.user.id;

  const message = created.error?.message ?? "";
  if (!/already|registered|exists|già/i.test(message)) {
    throw new Error(message || `Impossibile creare ${email}.`);
  }

  for (let page = 1; page <= 10; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    const found = listed.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (listed.data.users.length < 200) break;
  }

  throw new Error(`L'utente ${email} esiste già e non è stato recuperato. Controlla Authentication su Supabase.`);
}

async function highestTesterNumber(admin: ReturnType<typeof createAdminSupabase>) {
  let max = 0;
  for (let page = 1; page <= 20; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    for (const user of listed.data.users) {
      const match = user.email?.toLowerCase().match(/^tester-(\d+)@fantaventi\.test$/);
      if (!match) continue;
      max = Math.max(max, Number(match[1]));
    }
    if (listed.data.users.length < 200) break;
  }
  return max;
}

function playersByClub(players: CatalogPlayer[]) {
  const byClub = new Map<string, CatalogPlayer[]>();
  for (const player of players) {
    const list = byClub.get(player.clubId) ?? [];
    list.push(player);
    byClub.set(player.clubId, list);
  }
  return byClub;
}

function takeRole(
  pool: CatalogPlayer[],
  role: PlayerRole,
  teamIndex: number,
) {
  const matching = pool.filter((player) => player.role === role);
  if (matching.length === 0) return null;
  return matching[teamIndex % matching.length];
}

function buildRoster(
  players: CatalogPlayer[],
  clubs: ClubRef[],
  rules: Parameters<typeof evaluateRoster>[2],
  teamIndex: number,
) {
  if (clubs.length !== rules.squadSize) {
    throw httpError(`Il listone ha ${clubs.length} club e il regolamento ne prevede ${rules.squadSize}.`, 409);
  }

  const byClub = playersByClub(players);
  const ordered = [...clubs].sort((a, b) => a.code.localeCompare(b.code));
  const rotated = ordered.map((_, index) => ordered[(index + teamIndex) % ordered.length]);
  if (rules.squadSize !== 20) {
    const picked = rotated.map((club) => {
      const pool = byClub.get(club.id) ?? [];
      return pool[teamIndex % Math.max(pool.length, 1)] ?? null;
    }).filter((player): player is CatalogPlayer => player !== null);
    if (picked.length !== clubs.length) {
      throw httpError("Manca un calciatore per almeno un club del listone.", 409);
    }
    const report = evaluateRoster(picked, clubs, rules);
    if (!report.ready) {
      throw httpError(`Rosa di test non valida: ${picked.length} calciatori, portieri ${report.roles.GK}.`, 409);
    }
    return { picked, report };
  }
  const remaining: Record<PlayerRole, number> = { GK: 3, DEF: 6, MID: 6, FWD: 5 };
  const picked: CatalogPlayer[] = [];
  const rest = [...rotated];
  for (const role of ROLES) {
    let need = remaining[role];
    for (let index = 0; index < rest.length && need > 0;) {
      const choice = takeRole(byClub.get(rest[index].id) ?? [], role, teamIndex);
      if (!choice) {
        index += 1;
        continue;
      }
      picked.push(choice);
      rest.splice(index, 1);
      need -= 1;
    }
    if (need > 0) {
      throw httpError(
        `Non trovo ${need} ${role}. Esegui supabase_seed.sql con il listone da 120 calciatori.`,
        409,
      );
    }
  }
  if (rest.length > 0) {
    throw httpError("Sono rimasti club senza un ruolo libero nella rosa di test.", 409);
  }

  const report = evaluateRoster(picked, clubs, rules);
  if (!report.ready) {
    throw httpError(
      `Rosa di test non valida: ${picked.length} calciatori, portieri ${report.roles.GK}.`,
      409,
    );
  }
  return { picked, report };
}

function rollFor(seed: string) {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleBy<T>(items: T[], roll: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(roll() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy;
}

function variedTestLineup(roster: CatalogPlayer[], seed: string) {
  const roll = rollFor(seed);
  const byRole: Record<PlayerRole, CatalogPlayer[]> = {
    GK: shuffleBy(roster.filter((player) => player.role === "GK"), roll),
    DEF: shuffleBy(roster.filter((player) => player.role === "DEF"), roll),
    MID: shuffleBy(roster.filter((player) => player.role === "MID"), roll),
    FWD: shuffleBy(roster.filter((player) => player.role === "FWD"), roll),
  };
  const viable = FORMATIONS.filter((formation) =>
    byRole.GK.length >= 1
    && byRole.DEF.length >= formation.def
    && byRole.MID.length >= formation.mid
    && byRole.FWD.length >= formation.fwd
  );
  const formation = viable.length > 0 ? viable[Math.floor(roll() * viable.length)] : null;
  if (!formation) {
    const fallback = autoLineup(roster);
    if (!fallback?.captainId) throw httpError("La rosa non basta per schierare un modulo.", 409);
    return fallback;
  }
  const playerIds = [
    ...byRole.GK.slice(0, 1),
    ...byRole.DEF.slice(0, formation.def),
    ...byRole.MID.slice(0, formation.mid),
    ...byRole.FWD.slice(0, formation.fwd),
  ].map((player) => player.id);
  const onPitch = new Set(playerIds);
  const benchIds = ROLES.flatMap((role) => byRole[role].map((player) => player.id)).filter((playerId) => !onPitch.has(playerId));
  const outfield = playerIds.filter((playerId) => playerId !== byRole.GK[0]?.id);
  const captainId = outfield[Math.floor(roll() * Math.max(outfield.length, 1))] ?? playerIds[0] ?? null;
  const vicePool = playerIds.filter((playerId) => playerId !== captainId);
  const viceId = vicePool.length > 0 ? vicePool[Math.floor(roll() * vicePool.length)] ?? null : null;
  const issue = formationIssue(roster, playerIds);
  if (issue || !captainId) throw httpError(issue ?? "La rosa non basta per schierare un modulo.", 409);
  return { playerIds, benchIds, captainId, viceId };
}

async function replaceRoster(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  playerIds: string[],
  gameweek: number,
) {
  const { error: deleteError } = await admin.from("roster_stints").delete().eq("fantasy_team_id", teamId);
  if (deleteError) throw new Error(deleteError.message);

  const { error: insertError } = await admin.from("roster_stints").insert(
    playerIds.map((playerId) => ({
      id: randomUUID(),
      fantasy_team_id: teamId,
      player_id: playerId,
      active_from_gameweek: 1,
      active_until_gameweek: null,
    })),
  );
  if (insertError) throw new Error(insertError.message);

  const { error: validationError } = await admin.rpc("validate_fantasy_team_roster", {
    p_fantasy_team_id: teamId,
    p_gameweek: gameweek,
  });
  if (validationError) throw new Error(validationError.message);
}

async function fileLineups(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  roster: CatalogPlayer[],
  gameweeks: { id: string; number: number }[],
) {
  const { error: scoreError } = await admin.from("team_gameweek_scores").delete().eq("fantasy_team_id", teamId);
  if (scoreError) throw new Error(scoreError.message);
  const { error: lineupError } = await admin.from("lineups").delete().eq("fantasy_team_id", teamId);
  if (lineupError) throw new Error(lineupError.message);
  for (const gameweek of gameweeks) {
    await persistVariedLineup(admin, teamId, roster, gameweek.id, gameweek.number);
  }
  return gameweeks.length;
}

async function seasonGameweeks(
  admin: ReturnType<typeof createAdminSupabase>,
  seasonId: string,
  from: number,
  to: number,
) {
  const { data, error } = await admin
    .from("gameweeks")
    .select("id, number, status")
    .eq("season_id", seasonId)
    .gte("number", from)
    .lte("number", to)
    .order("number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; number: number; status: GameweekStatus }[];
}

export async function generateTestTeams(userId: string, leagueId: string): Promise<GeneratedTestTeam[]> {
  const league = await requireOwnedLeague(userId, leagueId);
  const admin = createAdminSupabase();
  const catalog = await loadCatalog();
  const weeks = await seasonGameweeks(admin, league.seasonId, league.startMatchday, league.endMatchday);
  const created: GeneratedTestTeam[] = [];
  const start = await highestTesterNumber(admin);

  for (let offset = 1; offset <= TEST_BATCH; offset += 1) {
    const number = start + offset;
    const teamName = `Tester ${number}`;
    const email = `tester-${number}@fantaventi.test`;
    const authId = await findOrCreateTestUser(admin, email);
    await ensureProfile(admin, authId, email);
    const { error: profileError } = await admin.from("profiles").update({ display_name: teamName }).eq("id", authId);
    if (profileError) throw new Error(profileError.message);

    const existing = await admin
      .from("fantasy_teams")
      .select("id")
      .eq("user_id", authId)
      .eq("season_id", league.seasonId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    let teamId = existing.data?.id as string | undefined;
    if (!teamId) {
      teamId = randomUUID();
      const { error } = await admin.from("fantasy_teams").insert({
        id: teamId,
        user_id: authId,
        season_id: league.seasonId,
        name: teamName,
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("fantasy_teams").update({ name: teamName }).eq("id", teamId);
      if (error) throw new Error(error.message);
    }

    const { picked, report } = buildRoster(catalog.players, catalog.clubs, catalog.rules, number);
    await replaceRoster(admin, teamId, picked.map((player) => player.id), league.startMatchday);
    const { error: memberError } = await admin.from("private_league_members").upsert(
      { private_league_id: leagueId, fantasy_team_id: teamId },
      { onConflict: "private_league_id,fantasy_team_id", ignoreDuplicates: true },
    );
    if (memberError) throw new Error(memberError.message);

    const playable = weeks.find((week) => week.status === "open")
      ?? weeks.find((week) => week.status === "scheduled")
      ?? weeks[0];
    created.push({
      email,
      password: TEST_TEAM_PASSWORD,
      teamName,
      fantasyTeamId: teamId,
      players: picked.length,
      goalkeepers: report.roles.GK,
      defenders: report.roles.DEF,
      midfielders: report.roles.MID,
      forwards: report.roles.FWD,
      lineupsFiled: 0,
      firstLineup: playable?.number ?? null,
    });
  }

  return created;
}

export async function activateGameweek(userId: string, gameweekId: string) {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const leagues = await ownedLeagues(admin, userId, season.id);
  if (leagues.length === 0) {
    throw httpError("Crea prima una lega: la giornata attiva si imposta da proprietario.", 403);
  }
  return activateSeasonGameweek(admin, season.id, gameweekId);
}

export async function fileTestLineups(userId: string, leagueId: string, gameweekId: string) {
  const league = await requireOwnedLeague(userId, leagueId);
  const admin = createAdminSupabase();
  const week = await admin
    .from("gameweeks")
    .select("id, number, status, deadline_at")
    .eq("id", gameweekId)
    .eq("season_id", league.seasonId)
    .maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) throw httpError("Giornata non trovata in questa stagione.", 404);
  if (week.data.status !== "open" || new Date(week.data.deadline_at as string).getTime() <= Date.now()) {
    throw httpError(`Imposta la giornata ${week.data.number as number} come attiva prima di schierare i bot.`, 409);
  }

  const members = await admin
    .from("private_league_members")
    .select("fantasy_team_id")
    .eq("private_league_id", leagueId);
  if (members.error) throw new Error(members.error.message);
  const teamIds = (members.data ?? []).map((row) => row.fantasy_team_id as string);
  if (teamIds.length === 0) return { gameweekNumber: week.data.number as number, filed: 0, teams: [] as string[] };

  const teams = await admin.from("fantasy_teams").select("id, user_id, name").in("id", teamIds);
  if (teams.error) throw new Error(teams.error.message);
  const userIds = (teams.data ?? []).map((row) => row.user_id as string);
  const profiles = userIds.length
    ? await admin.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error(profiles.error.message);
  const names = new Map((profiles.data ?? []).map((row) => [row.id as string, row.display_name as string]));
  const testers = (teams.data ?? []).filter((row) => /^Tester \d+$/.test(names.get(row.user_id as string) ?? ""));

  const catalog = await loadCatalog();
  const byId = new Map(catalog.players.map((player) => [player.id, player]));
  const filed: string[] = [];
  for (const tester of testers) {
    const roster = await rosterAt(admin, tester.id as string, week.data.number as number, byId);
    if (roster.length === 0) continue;
    await persistVariedLineup(admin, tester.id as string, roster, gameweekId, week.data.number as number);
    filed.push(tester.name as string);
  }
  return { gameweekNumber: week.data.number as number, filed: filed.length, teams: filed };
}

async function rosterAt(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  gameweek: number,
  byId: Map<string, CatalogPlayer>,
) {
  const { data, error } = await admin
    .from("roster_stints")
    .select("player_id, active_from_gameweek, active_until_gameweek")
    .eq("fantasy_team_id", teamId);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const from = row.active_from_gameweek as number;
    const until = row.active_until_gameweek as number | null;
    if (from > gameweek || (until !== null && until < gameweek)) return [];
    const player = byId.get(row.player_id as string);
    return player ? [player] : [];
  });
}

async function persistVariedLineup(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  roster: CatalogPlayer[],
  gameweekId: string,
  gameweekNumber: number,
) {
  const picked = variedTestLineup(roster, `${teamId}:${gameweekNumber}`);

  const { error: deleteError } = await admin
    .from("lineups")
    .delete()
    .eq("fantasy_team_id", teamId)
    .eq("gameweek_id", gameweekId);
  if (deleteError) throw new Error(deleteError.message);

  const lineupId = randomUUID();
  const savedAt = new Date().toISOString();
  const withStamp = await admin.from("lineups").insert({
    id: lineupId,
    fantasy_team_id: teamId,
    gameweek_id: gameweekId,
    status: "draft",
    saved_at: savedAt,
  });
  const insertError = withStamp.error && /saved_at|schema cache/i.test(withStamp.error.message)
    ? (await admin.from("lineups").insert({
      id: lineupId,
      fantasy_team_id: teamId,
      gameweek_id: gameweekId,
      status: "draft",
    })).error
    : withStamp.error;
  if (insertError) throw new Error(insertError.message);

  const slots = [
    ...picked.playerIds.map((playerId, index) => ({
      lineup_id: lineupId,
      player_id: playerId,
      is_captain: playerId === picked.captainId,
      is_vice_captain: playerId === picked.viceId,
      is_starter: true,
      slot_order: index + 1,
    })),
    ...picked.benchIds.map((playerId, index) => ({
      lineup_id: lineupId,
      player_id: playerId,
      is_captain: false,
      is_vice_captain: false,
      is_starter: false,
      slot_order: index + 1,
    })),
  ];
  const { error: slotError } = await admin.from("lineup_slots").insert(slots);
  if (slotError) throw new Error(slotError.message);
}

export async function setAdminLineups(
  userId: string,
  leagueId: string,
  gameweekId: string,
  filed: boolean,
  fantasyTeamId?: string,
) {
  const league = await requireOwnedLeague(userId, leagueId);
  const admin = createAdminSupabase();
  const week = await admin
    .from("gameweeks")
    .select("id, number")
    .eq("id", gameweekId)
    .eq("season_id", league.seasonId)
    .maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) throw httpError("Giornata non trovata in questa stagione.", 404);

  const mine = await getFantasyTeam(admin, userId, league.seasonId);
  const teamIds = league.participants.map((participant) => participant.fantasyTeamId);
  if (mine && !teamIds.includes(mine.id)) teamIds.push(mine.id);
  const targets = fantasyTeamId ? teamIds.filter((teamId) => teamId === fantasyTeamId) : teamIds;
  if (fantasyTeamId && targets.length === 0) throw httpError("Questa squadra non è nella lega.", 404);

  const catalog = await loadCatalog(league.seasonId);
  const byId = new Map(catalog.players.map((player) => [player.id, player]));
  let changed = 0;
  for (const teamId of targets) {
    if (!filed) {
      const { error } = await admin.from("lineups").delete().eq("fantasy_team_id", teamId).eq("gameweek_id", gameweekId);
      if (error) throw new Error(error.message);
      changed += 1;
      continue;
    }
    const roster = await rosterAt(admin, teamId, week.data.number as number, byId);
    if (roster.length === 0) {
      if (fantasyTeamId) throw httpError("Questa squadra non ha una rosa su questa giornata.", 409);
      continue;
    }
    await persistVariedLineup(admin, teamId, roster, gameweekId, week.data.number as number);
    changed += 1;
  }
  return { gameweekNumber: week.data.number as number, changed, filed };
}

export async function setGameweekStatus(userId: string, gameweekId: string, status: string) {
  if (!isGameweekStatus(status)) throw httpError("Stato giornata non valido.", 400);
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const leagues = await ownedLeagues(admin, userId, season.id);
  if (leagues.length === 0) {
    throw httpError("Crea prima una lega: lo stato delle giornate si cambia da proprietario.", 403);
  }

  const patch: { status: GameweekStatus; scored_at?: string } = { status };
  if (status === "scored") patch.scored_at = new Date().toISOString();
  let updated = await admin
    .from("gameweeks")
    .update(patch)
    .eq("id", gameweekId)
    .eq("season_id", season.id)
    .select("id, number, status, deadline_at")
    .maybeSingle();
  if (updated.error && status === "scored" && /scored_at/i.test(updated.error.message)) {
    updated = await admin
      .from("gameweeks")
      .update({ status })
      .eq("id", gameweekId)
      .eq("season_id", season.id)
      .select("id, number, status, deadline_at")
      .maybeSingle();
  }
  const { data, error } = updated;
  if (error) throw new Error(error.message);
  if (!data) throw httpError("Giornata non trovata in questa stagione.", 404);

  return {
    id: data.id as string,
    number: data.number as number,
    status: data.status as GameweekStatus,
    deadlineAt: data.deadline_at as string,
  };
}

function near(left: number, right: number, tolerance = 0.08) {
  return Math.abs(left - right) < tolerance;
}

export async function lateJoinTest(
  userId: string,
  leagueId: string,
  entryMatchday: number,
): Promise<LateJoinReport> {
  const league = await requireOwnedLeague(userId, leagueId);
  if (!Number.isInteger(entryMatchday)) throw httpError("La giornata di ingresso deve essere un numero intero.", 400);
  if (entryMatchday <= league.startMatchday || entryMatchday > league.endMatchday) {
    throw httpError(
      `L'ingresso deve essere tra la giornata ${league.startMatchday + 1} e la ${league.endMatchday}.`,
      400,
    );
  }

  const admin = createAdminSupabase();
  const prior = await seasonGameweeks(admin, league.seasonId, league.startMatchday, entryMatchday - 1);
  const entryRows = await seasonGameweeks(admin, league.seasonId, entryMatchday, entryMatchday);
  const entryWeek = entryRows[0];
  if (!entryWeek || prior.length !== entryMatchday - league.startMatchday) {
    throw httpError("Nel calendario manca una giornata del range. Esegui calendar_setup.sql.", 409);
  }
  if (entryWeek.status === "final") {
    throw httpError(`La giornata ${entryMatchday} è final. Riportala a open dalla control room e riprova.`, 409);
  }

  const catalog = await loadCatalog();
  const stamp = randomUUID().slice(0, 4);
  const teamName = `Ingresso G${entryMatchday} ${stamp}`;
  const email = `ingresso-${entryMatchday}-${stamp}@fantaventi.test`;
  const authId = await findOrCreateTestUser(admin, email);
  await ensureProfile(admin, authId, email);
  const { error: profileError } = await admin.from("profiles").update({ display_name: teamName }).eq("id", authId);
  if (profileError) throw new Error(profileError.message);

  const teamId = randomUUID();
  const { error: teamError } = await admin.from("fantasy_teams").insert({
    id: teamId,
    user_id: authId,
    season_id: league.seasonId,
    name: teamName,
  });
  if (teamError) throw new Error(teamError.message);

  const { picked } = buildRoster(catalog.players, catalog.clubs, catalog.rules, 5);
  await replaceRoster(admin, teamId, picked.map((player) => player.id), entryMatchday);
  const { error: memberError } = await admin.from("private_league_members").upsert(
    { private_league_id: leagueId, fantasy_team_id: teamId },
    { onConflict: "private_league_id,fantasy_team_id", ignoreDuplicates: true },
  );
  if (memberError) throw new Error(memberError.message);

  await fileLineups(admin, teamId, picked, [entryWeek]);

  const weeksPrepared: number[] = [];
  for (const gameweek of prior) {
    if (gameweek.status === "final") {
      weeksPrepared.push(gameweek.number);
      continue;
    }
    await simulateLeagueGameweek(userId, { leagueId, gameweekId: gameweek.id, status: "scored" });
    weeksPrepared.push(gameweek.number);
  }
  await simulateLeagueGameweek(userId, { leagueId, gameweekId: entryWeek.id, status: "scored" });

  const hub = await loadLeagueHub(userId, leagueId);
  const standing = hub.standings.find((row) => row.fantasyTeamId === teamId) ?? null;
  const expectedSkipped = hub.gameweeks.filter(
    (gameweek) => gameweek.number >= league.startMatchday && gameweek.number < entryMatchday && gameweek.locked,
  ).length;

  const notes: string[] = [];
  if (!standing) {
    notes.push("La squadra non compare in classifica.");
  } else {
    notes.push(
      `Ingresso ${standing.entryPoints} = media ${standing.average ?? 0} × ${standing.skipped} giornate saltate.`,
    );
    notes.push(
      `Totale ${standing.points} = ingresso ${standing.entryPoints} + reali ${standing.realPoints} dalla giornata ${entryMatchday}.`,
    );
    if (standing.skipped !== expectedSkipped) {
      notes.push(`Giornate saltate attese ${expectedSkipped}, in classifica ${standing.skipped}.`);
    }
    if (standing.played < 1) {
      notes.push("Nessuna giornata disputata dalla giornata di ingresso.");
    }
    if (!near(standing.points, standing.realPoints + standing.entryPoints)) {
      notes.push("Il totale non è la somma di ingresso e punti reali.");
    }
    const entryTolerance = 0.03 + 0.015 * standing.skipped;
    const rebuiltEntry = standing.average === null || standing.skipped === 0
      ? 0
      : Math.round(standing.average * standing.skipped * 100) / 100;
    if (standing.skipped > 0 && !near(standing.entryPoints, rebuiltEntry, entryTolerance)) {
      notes.push("I punti di ingresso non coincidono con la media delle giornate precedenti × giornate saltate.");
    }
  }

  const entryTolerance = standing ? 0.03 + 0.015 * standing.skipped : 0.08;
  const rebuiltEntry = standing && standing.average !== null && standing.skipped > 0
    ? Math.round(standing.average * standing.skipped * 100) / 100
    : 0;
  const ok = Boolean(
    standing
    && standing.skipped === expectedSkipped
    && expectedSkipped === entryMatchday - league.startMatchday
    && standing.played >= 1
    && near(standing.points, standing.realPoints + standing.entryPoints)
    && (standing.skipped === 0 || near(standing.entryPoints, rebuiltEntry, entryTolerance)),
  );

  return {
    email,
    password: TEST_TEAM_PASSWORD,
    teamName,
    fantasyTeamId: teamId,
    entryMatchday,
    startMatchday: league.startMatchday,
    weeksPrepared,
    standing: standing
      ? {
        rank: standing.rank,
        teamName: standing.teamName,
        points: standing.points,
        realPoints: standing.realPoints,
        entryPoints: standing.entryPoints,
        played: standing.played,
        skipped: standing.skipped,
        average: standing.average,
      }
      : null,
    expectedSkipped,
    ok,
    notes,
  };
}

const ROLE_ORDER: Record<PlayerRole, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export async function loadGameweekScores(userId: string, leagueId: string, gameweekId: string) {
  const league = await requireOwnedLeague(userId, leagueId);
  const admin = createAdminSupabase();
  const week = await admin
    .from("gameweeks")
    .select("id, number, status")
    .eq("id", gameweekId)
    .eq("season_id", league.seasonId)
    .maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) throw httpError("Giornata non trovata in questa stagione.", 404);

  const { data, error } = await admin
    .from("team_gameweek_scores")
    .select("fantasy_team_id, players_points, captain_modifier, fair_play, defense_modifier, reserve_points, total")
    .eq("gameweek_id", gameweekId);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const teamIds = rows.map((row) => row.fantasy_team_id as string);
  const names = new Map(league.participants.map((team) => [team.fantasyTeamId, team.teamName]));
  if (teamIds.some((teamId) => !names.has(teamId))) {
    const teams = await admin.from("fantasy_teams").select("id, name").in("id", teamIds);
    if (teams.error) throw new Error(teams.error.message);
    for (const team of teams.data ?? []) names.set(team.id as string, team.name as string);
  }

  const numberOf = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    gameweekId,
    gameweekNumber: week.data.number as number,
    status: week.data.status as string,
    scores: rows.map((row) => ({
      fantasyTeamId: row.fantasy_team_id as string,
      teamName: names.get(row.fantasy_team_id as string) ?? "Squadra",
      total: numberOf(row.total),
      playersPoints: numberOf(row.players_points),
      captainModifier: numberOf(row.captain_modifier),
      fairPlay: numberOf(row.fair_play),
      defenseModifier: numberOf(row.defense_modifier),
      reservePoints: numberOf(row.reserve_points),
    })),
  };
}

export async function loadAdminLineups(userId: string, leagueId: string, gameweekId: string): Promise<AdminFiledLineup[]> {
  const league = await getLeagueDetail(userId, leagueId);
  if (!league.isOwner) throw httpError("Solo chi ha creato la lega vede le formazioni degli altri.", 403);
  const admin = createAdminSupabase();
  const catalog = await loadCatalog(league.seasonId);
  const byId = new Map(catalog.players.map((player) => [player.id, player]));
  const mine = await getFantasyTeam(admin, userId, league.seasonId);
  const participants = [...league.participants];
  if (mine && !participants.some((participant) => participant.fantasyTeamId === mine.id)) {
    participants.unshift({
      fantasyTeamId: mine.id,
      userId,
      teamName: mine.name,
      displayName: "Tu",
    });
  }
  const teamIds = participants.map((participant) => participant.fantasyTeamId);
  if (teamIds.length === 0) return [];

  const { data: lineups, error } = await admin
    .from("lineups")
    .select("id, fantasy_team_id, saved_at")
    .eq("gameweek_id", gameweekId)
    .in("fantasy_team_id", teamIds);
  const listed = error && /saved_at|schema cache/i.test(error.message)
    ? await admin
      .from("lineups")
      .select("id, fantasy_team_id")
      .eq("gameweek_id", gameweekId)
      .in("fantasy_team_id", teamIds)
    : { data: lineups, error };
  if (listed.error) throw new Error(listed.error.message);
  const lineupRows = listed.data ?? [];
  const lineupIds = lineupRows.map((row) => row.id as string);
  const extended = lineupIds.length
    ? await admin
      .from("lineup_slots")
      .select("lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order")
      .in("lineup_id", lineupIds)
    : { data: [], error: null };
  const slots = extended.error && /is_starter|slot_order/i.test(extended.error.message)
    ? await admin
      .from("lineup_slots")
      .select("lineup_id, player_id, is_captain, is_vice_captain")
      .in("lineup_id", lineupIds)
    : extended;
  if (slots.error) throw new Error(slots.error.message);

  return participants.map((participant) => {
    const lineup = lineupRows.find((row) => row.fantasy_team_id === participant.fantasyTeamId);
    const rows = (slots.data ?? [])
      .filter((slot) => slot.lineup_id === lineup?.id)
      .map((slot) => {
        const record = slot as {
          player_id: string;
          is_captain: boolean;
          is_vice_captain: boolean;
          is_starter?: boolean;
          slot_order?: number;
        };
        const player = byId.get(record.player_id);
        return {
          fullName: player?.fullName ?? "Calciatore",
          role: player?.role ?? "MID" as PlayerRole,
          clubShort: player?.clubShort ?? "",
          isCaptain: Boolean(record.is_captain),
          isVice: Boolean(record.is_vice_captain),
          isStarter: record.is_starter !== false,
          slotOrder: Number(record.slot_order ?? 0),
        };
      });
    const starters = rows
      .filter((row) => row.isStarter)
      .sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || left.fullName.localeCompare(right.fullName, "it"));
    const bench = rows
      .filter((row) => !row.isStarter)
      .sort((left, right) => left.slotOrder - right.slotOrder);
    return {
      fantasyTeamId: participant.fantasyTeamId,
      teamName: participant.teamName,
      displayName: participant.displayName,
      isMine: participant.fantasyTeamId === mine?.id,
      filed: Boolean(lineup),
      savedAt: (lineup as { saved_at?: string | null } | undefined)?.saved_at ?? null,
      starters,
      bench,
    };
  });
}
