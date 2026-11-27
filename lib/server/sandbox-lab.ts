import { randomUUID } from "node:crypto";
import { evaluateRoster } from "@/lib/constraints";
import { scoreLineup, type LineupSlotInput, type PlayerStat, type RulesetDefinition } from "@/lib/engine/calculator";
import { autoLineup, formationIssue } from "@/lib/formations";
import { createJoinCode } from "@/lib/join-code";
import { DEFAULT_LEAGUE_RULES } from "@/lib/league-rules";
import { getCurrentSeason, loadCatalog } from "@/lib/server/catalog";
import { definitionForLeague } from "@/lib/server/league-settings";
import { holeIdsKeepingHeldPlayers } from "@/lib/server/held-lineup";
import { buildLegalRoster } from "@/lib/scenario/roster";
import { missingSandboxColumn, SANDBOX_LEAGUE_NAME, SANDBOX_SEASON_CODE, SANDBOX_SQL } from "@/lib/server/sandbox-flag";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { CatalogPlayer, PlayerRole } from "@/lib/types";

const CHECKPOINTS = [10, 20, 40, 80, 120, 160];
const BATCH = 5;
const TEAM_COUNT = 100;
const WEEK_CAP = 200;
const FAR_DEADLINE = "2099-01-01T00:00:00.000Z";

export type SandboxPodiumRow = {
  rank: number;
  name: string;
  total: number;
};

export type SandboxReport = {
  elapsedMs: number;
  weeks: number[];
  checkpoints: number;
  anomalies: string[];
  nextCursor: number | null;
  teams: number;
  podium: SandboxPodiumRow[];
};

type PreparedTeam = {
  id: string;
  name: string;
  slots: LineupSlotInput[];
  roster: CatalogPlayer[];
};

function pad(index: number) {
  return String(index).padStart(3, "0");
}

function randomizer(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

async function assertSandboxSchema() {
  const admin = createAdminSupabase();
  const probe = await admin.from("private_leagues").select("is_sandbox").limit(1);
  if (probe.error && missingSandboxColumn(probe.error.message)) throw new Error(SANDBOX_SQL);
  if (probe.error) throw new Error(probe.error.message);
  const teams = await admin.from("fantasy_teams").select("is_sandbox").limit(1);
  if (teams.error && missingSandboxColumn(teams.error.message)) throw new Error(SANDBOX_SQL);
  if (teams.error) throw new Error(teams.error.message);
}

async function sandboxSeasonId() {
  const admin = createAdminSupabase();
  const { data, error } = await admin.from("seasons").select("id").eq("code", SANDBOX_SEASON_CODE).eq("is_sandbox", true).maybeSingle();
  if (error) throw new Error(missingSandboxColumn(error.message) ? SANDBOX_SQL : error.message);
  return (data?.id as string | undefined) ?? null;
}

async function sandboxLeague() {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("private_leagues")
    .select("id, season_id")
    .eq("name", SANDBOX_LEAGUE_NAME)
    .eq("is_sandbox", true)
    .maybeSingle();
  if (error) throw new Error(missingSandboxColumn(error.message) ? SANDBOX_SQL : error.message);
  return data as { id: string; season_id: string } | null;
}

async function sandboxTeamIds() {
  const admin = createAdminSupabase();
  const { data, error } = await admin.from("fantasy_teams").select("id").eq("is_sandbox", true);
  if (error) throw new Error(missingSandboxColumn(error.message) ? SANDBOX_SQL : error.message);
  return (data ?? []).map((row) => row.id as string);
}

export async function resetSandbox() {
  await assertSandboxSchema();
  const admin = createAdminSupabase();
  const seasonId = await sandboxSeasonId();
  const league = await sandboxLeague();
  const teamIds = await sandboxTeamIds();
  const weekIds = seasonId
    ? ((await admin.from("gameweeks").select("id").eq("season_id", seasonId)).data ?? []).map((row) => row.id as string)
    : [];

  if (teamIds.length > 0) {
    await admin.from("lineup_player_scores").delete().in("fantasy_team_id", teamIds);
    await admin.from("team_gameweek_scores").delete().in("fantasy_team_id", teamIds);
    const lineups = await admin.from("lineups").select("id").in("fantasy_team_id", teamIds);
    const lineupIds = (lineups.data ?? []).map((row) => row.id as string);
    if (lineupIds.length > 0) await admin.from("lineup_slots").delete().in("lineup_id", lineupIds);
    await admin.from("lineups").delete().in("fantasy_team_id", teamIds);
    await admin.from("roster_stints").delete().in("fantasy_team_id", teamIds);
    await admin.from("private_league_members").delete().in("fantasy_team_id", teamIds);
    const removed = await admin.from("fantasy_teams").delete().in("id", teamIds).eq("is_sandbox", true);
    if (removed.error) throw new Error(removed.error.message);
  }
  if (weekIds.length > 0) {
    await admin.from("player_gameweek_stats").delete().in("gameweek_id", weekIds);
    await admin.from("vote_imports").delete().in("gameweek_id", weekIds);
    const removedWeeks = await admin.from("gameweeks").delete().in("id", weekIds).eq("season_id", seasonId);
    if (removedWeeks.error) throw new Error(removedWeeks.error.message);
  }
  if (league) {
    await admin.from("private_league_members").delete().eq("private_league_id", league.id);
    const removedLeague = await admin.from("private_leagues").delete().eq("id", league.id).eq("is_sandbox", true);
    if (removedLeague.error) throw new Error(removedLeague.error.message);
  }
  if (seasonId) {
    const removedSeason = await admin.from("seasons").delete().eq("id", seasonId).eq("is_sandbox", true).eq("code", SANDBOX_SEASON_CODE);
    if (removedSeason.error) throw new Error(removedSeason.error.message);
  }
  return { teams: teamIds.length, weeks: weekIds.length, league: Boolean(league) };
}

export async function seedSandbox(ownerId: string) {
  await assertSandboxSchema();
  await resetSandbox();
  const admin = createAdminSupabase();
  const real = await getCurrentSeason(admin);
  const catalog = await loadCatalog(real.id);
  if (catalog.clubs.length !== catalog.rules.squadSize) {
    throw new Error(`Il listone ha ${catalog.clubs.length} club e la rosa ne chiede ${catalog.rules.squadSize}. Il seeder non allenta la regola di un calciatore per club.`);
  }
  const rosters = Array.from({ length: TEAM_COUNT }, (_, index) => {
    const picked = buildLegalRoster(catalog.players, catalog.clubs, catalog.rules, index);
    const report = evaluateRoster(picked, catalog.clubs, catalog.rules);
    if (!report.ready || report.duplicateClubs.length > 0 || new Set(picked.map((player) => player.clubId)).size !== picked.length) {
      throw new Error(`Squadra Test ${pad(index + 1)} non rispetta un calciatore per club o i limiti di ruolo.`);
    }
    const lineup = autoLineup(picked);
    if (!lineup || lineup.playerIds.length !== 11 || formationIssue(picked, lineup.playerIds)) {
      throw new Error(`Squadra Test ${pad(index + 1)} non ha una formazione valida.`);
    }
    return { picked, lineup };
  });

  const source = await admin.from("seasons").select("competition_id, ruleset_id").eq("id", real.id).single();
  if (source.error || !source.data) throw new Error(source.error?.message ?? "Stagione reale non trovata.");
  const seasonId = randomUUID();
  const createdSeason = await admin.from("seasons").insert({
    id: seasonId,
    competition_id: source.data.competition_id,
    ruleset_id: source.data.ruleset_id,
    code: SANDBOX_SEASON_CODE,
    status: "running",
    starts_on: "2099-01-01",
    ends_on: "2099-12-31",
    is_sandbox: true,
  });
  if (createdSeason.error) throw new Error(missingSandboxColumn(createdSeason.error.message) ? SANDBOX_SQL : createdSeason.error.message);

  const gameweeks = Array.from({ length: WEEK_CAP }, (_, index) => ({
    id: randomUUID(),
    season_id: seasonId,
    number: index + 1,
    deadline_at: FAR_DEADLINE,
    status: "scheduled",
  }));
  for (let offset = 0; offset < gameweeks.length; offset += 50) {
    const createdWeeks = await admin.from("gameweeks").insert(gameweeks.slice(offset, offset + 50));
    if (createdWeeks.error) throw new Error(createdWeeks.error.message);
  }

  const leagueId = randomUUID();
  const settings = {
    ...DEFAULT_LEAGUE_RULES,
    budget: 0,
    checkpoints: CHECKPOINTS.map((afterMatchday) => ({ afterMatchday, changes: 3 })),
  };
  let joinCode = createJoinCode();
  let leagueError = (await admin.from("private_leagues").insert({
    id: leagueId,
    season_id: real.id,
    owner_user_id: ownerId,
    name: SANDBOX_LEAGUE_NAME,
    join_code: joinCode,
    start_matchday: 1,
    end_matchday: WEEK_CAP,
    settings,
    competition_format: "classic",
    is_sandbox: true,
  })).error;
  if (leagueError && /end_matchday|check constraint/i.test(leagueError.message)) {
    leagueError = (await admin.from("private_leagues").insert({
      id: leagueId,
      season_id: real.id,
      owner_user_id: ownerId,
      name: SANDBOX_LEAGUE_NAME,
      join_code: joinCode,
      start_matchday: 1,
      end_matchday: 38,
      settings,
      competition_format: "classic",
      is_sandbox: true,
    })).error;
  }
  if (leagueError && /join_code/i.test(leagueError.message)) {
    joinCode = createJoinCode();
    leagueError = (await admin.from("private_leagues").insert({
      id: leagueId,
      season_id: real.id,
      owner_user_id: ownerId,
      name: SANDBOX_LEAGUE_NAME,
      join_code: joinCode,
      start_matchday: 1,
      end_matchday: 38,
      settings,
      is_sandbox: true,
    })).error;
  }
  if (leagueError) throw new Error(leagueError.message);

  const teams = rosters.map((_, index) => ({
    id: randomUUID(),
    user_id: ownerId,
    season_id: real.id,
    name: `Squadra Test ${pad(index + 1)}`,
    is_sandbox: true,
  }));
  const createdTeams = await admin.from("fantasy_teams").insert(teams);
  if (createdTeams.error) {
    throw new Error(/unique|duplicate key/i.test(createdTeams.error.message) ? `${SANDBOX_SQL} ${createdTeams.error.message}` : createdTeams.error.message);
  }
  const members = await admin.from("private_league_members").insert(teams.map((team) => ({
    private_league_id: leagueId,
    fantasy_team_id: team.id,
  })));
  if (members.error) throw new Error(members.error.message);
  const stints = teams.flatMap((team, index) => rosters[index].picked.map((player) => ({
    id: randomUUID(),
    fantasy_team_id: team.id,
    player_id: player.id,
    active_from_gameweek: 1,
    active_until_gameweek: null,
  })));
  for (let offset = 0; offset < stints.length; offset += 500) {
    const inserted = await admin.from("roster_stints").insert(stints.slice(offset, offset + 500));
    if (inserted.error) throw new Error(inserted.error.message);
  }
  for (const team of teams) {
    const { error } = await admin.rpc("validate_fantasy_team_roster", { p_fantasy_team_id: team.id, p_gameweek: 1 });
    if (error) {
      await resetSandbox();
      throw new Error(`Il validatore della rosa ha rifiutato ${team.name}: ${error.message}`);
    }
  }
  return { leagueId, teams: teams.length, weeks: gameweeks.length, rostersValid: rosters.length };
}

export async function simulateSandbox(cursor: number, requested: number): Promise<SandboxReport> {
  const started = Date.now();
  await assertSandboxSchema();
  const size = [1, 10, 40, 50, 200].includes(requested) ? requested : 40;
  const from = Math.max(1, Math.floor(cursor) || 1);
  if (from > size) {
    return { elapsedMs: 0, weeks: [], checkpoints: 0, anomalies: [], nextCursor: null, teams: 0, podium: [] };
  }
  const admin = createAdminSupabase();
  const league = await sandboxLeague();
  const seasonId = await sandboxSeasonId();
  if (!league || !seasonId) throw new Error("Prima genera la lega sandbox.");
  const real = await getCurrentSeason(admin);
  const source = await admin.from("seasons").select("ruleset_id, rulesets(definition)").eq("id", real.id).single();
  if (source.error || !source.data) throw new Error(source.error?.message ?? "Ruleset non trovato.");
  const ruleset = Array.isArray(source.data.rulesets) ? source.data.rulesets[0] : source.data.rulesets;
  const { definition } = await definitionForLeague(admin, league.id, (ruleset?.definition ?? {}) as RulesetDefinition, null);
  const rulesetId = source.data.ruleset_id as string;
  const prepared = await loadPreparedTeams(real.id);
  const until = Math.min(size, from + BATCH - 1);
  const weeks = await admin.from("gameweeks").select("id, number").eq("season_id", seasonId).gte("number", from).lte("number", until);
  if (weeks.error) throw new Error(weeks.error.message);
  const weekByNumber = new Map((weeks.data ?? []).map((row) => [row.number as number, row.id as string]));
  const anomalies: string[] = [];
  const done: number[] = [];
  let checkpoints = 0;
  let validatorMissing = false;

  for (let number = from; number <= until; number += 1) {
    const gameweekId = weekByNumber.get(number);
    if (!gameweekId) {
      anomalies.push(`Manca la giornata sandbox ${number}.`);
      continue;
    }
    const rand = randomizer(number * 10007);
    const stats = new Map<string, PlayerStat>();
    const scores = prepared.map((team) => {
      const starters = team.slots.filter((slot) => slot.benchOrder == null);
      for (const slot of team.slots) {
        const player = team.roster.find((item) => item.id === slot.playerId);
        const hole = starters.some((starter, index) => starter.playerId === slot.playerId && index === number % starters.length);
        stats.set(slot.playerId, statFor(slot.playerId, player?.role ?? "MID", hole, rand));
      }
      const score = scoreLineup(
        team.id,
        team.slots,
        stats,
        definition,
        holeIdsKeepingHeldPlayers(team.slots, stats, definition.lineup_size ?? 11),
      );
      const silent = score.players.filter((player) => player.voto == null).length;
      if (silent > 0) anomalies.push(`${team.name}, giornata ${number}: ${silent} titolari senza voto e senza sostituto.`);
      if (!Number.isFinite(score.total)) anomalies.push(`${team.name}, giornata ${number}: punteggio non numerico.`);
      return score;
    }).filter((score) => Number.isFinite(score.total));

    if (scores.length > 0) {
      const saved = await admin.from("team_gameweek_scores").upsert(scores.map((score) => ({
        fantasy_team_id: score.fantasyTeamId,
        gameweek_id: gameweekId,
        ruleset_id: rulesetId,
        players_points: score.playersPoints,
        captain_modifier: score.captainModifier,
        captain_player_id: score.captainPlayerId,
        fair_play: score.fairPlay,
        defense_modifier: score.defenseModifier,
        defense_average: score.defenseAverage,
        reserve_points: score.reservePoints,
        total: score.total,
        provisional_total: score.total,
        rated_players_count: score.players.filter((player) => player.voto !== null).length,
        on_pitch_count: score.players.length,
        is_live: false,
      })), { onConflict: "fantasy_team_id,gameweek_id" });
      if (saved.error) anomalies.push(`Giornata ${number}: ${saved.error.message}`);
    }
    const closed = await admin
      .from("gameweeks")
      .update({ status: "scored", scored_at: new Date().toISOString() })
      .eq("id", gameweekId)
      .eq("season_id", seasonId);
    if (closed.error) anomalies.push(`Giornata ${number}: chiusura non registrata. ${closed.error.message}`);
    if (CHECKPOINTS.includes(number)) {
      checkpoints += 1;
      if (!validatorMissing) {
        for (const team of prepared) {
          const distinctClubs = new Set(team.roster.map((player) => player.clubId)).size;
          if (distinctClubs !== team.roster.length) anomalies.push(`${team.name}: al checkpoint ${number} un club è ripetuto.`);
          const { error } = await admin.rpc("validate_fantasy_team_roster", { p_fantasy_team_id: team.id, p_gameweek: Math.min(number, 38) });
          if (error && /validate_fantasy_team_roster|schema cache|could not find/i.test(error.message)) {
            validatorMissing = true;
            anomalies.push("Il validatore SQL della rosa non è disponibile. Esegui roster_validation.sql.");
            break;
          }
          if (error) anomalies.push(`${team.name}, checkpoint ${number}: ${error.message}`);
        }
      }
    }
    done.push(number);
  }

  const next = until >= size ? null : until + 1;
  const names = new Map(prepared.map((team) => [team.id, team.name]));
  const podium = next == null ? await loadPodium(seasonId, size, names) : [];
  return {
    elapsedMs: Date.now() - started,
    weeks: done,
    checkpoints,
    anomalies: anomalies.slice(0, 40),
    nextCursor: next,
    teams: prepared.length,
    podium,
  };
}

async function loadPodium(seasonId: string, size: number, names: Map<string, string>): Promise<SandboxPodiumRow[]> {
  const admin = createAdminSupabase();
  const weeks = await admin.from("gameweeks").select("id").eq("season_id", seasonId).gte("number", 1).lte("number", size);
  if (weeks.error) throw new Error(weeks.error.message);
  const weekIds = (weeks.data ?? []).map((row) => row.id as string);
  const totals = new Map<string, number>();
  let start = 0;
  while (weekIds.length > 0) {
    const page = await admin
      .from("team_gameweek_scores")
      .select("fantasy_team_id, total")
      .in("gameweek_id", weekIds)
      .range(start, start + 999);
    if (page.error) throw new Error(page.error.message);
    const rows = page.data ?? [];
    for (const row of rows) {
      const total = Number(row.total);
      if (!Number.isFinite(total)) continue;
      const id = row.fantasy_team_id as string;
      totals.set(id, (totals.get(id) ?? 0) + total);
    }
    if (rows.length < 1000) break;
    start += 1000;
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || (names.get(left[0]) ?? "").localeCompare(names.get(right[0]) ?? "", "it"))
    .slice(0, 3)
    .map(([id, total], index) => ({
      rank: index + 1,
      name: names.get(id) ?? id,
      total: Math.round(total * 100) / 100,
    }));
}

function statFor(playerId: string, role: PlayerRole, hole: boolean, rand: () => number): PlayerStat {
  const roll = rand();
  return {
    playerId,
    role,
    voto: hole ? null : Math.round((4 + roll * 6) * 2) / 2,
    goals: hole || rand() > 0.12 ? 0 : rand() > 0.8 ? 2 : 1,
    assists: hole || rand() > 0.1 ? 0 : 1,
    yellowCards: hole || rand() > 0.15 ? 0 : 1,
    redCards: hole || rand() > 0.02 ? 0 : 1,
    penaltiesScored: 0,
    penaltiesMissed: 0,
    penaltiesSaved: 0,
    ownGoals: hole || rand() > 0.02 ? 0 : 1,
    goalsConceded: role === "GK" && !hole && rand() < 0.45 ? 1 : 0,
  };
}

async function loadPreparedTeams(realSeasonId: string): Promise<PreparedTeam[]> {
  const admin = createAdminSupabase();
  const catalog = await loadCatalog(realSeasonId);
  const byId = new Map(catalog.players.map((player) => [player.id, player]));
  const ids = await sandboxTeamIds();
  if (ids.length === 0) return [];
  const stints = await admin.from("roster_stints").select("fantasy_team_id, player_id").in("fantasy_team_id", ids);
  if (stints.error) throw new Error(stints.error.message);
  const names = await admin.from("fantasy_teams").select("id, name").in("id", ids).eq("is_sandbox", true);
  const nameOf = new Map((names.data ?? []).map((row) => [row.id as string, row.name as string]));
  const grouped = new Map<string, CatalogPlayer[]>();
  for (const row of stints.data ?? []) {
    const player = byId.get(row.player_id as string);
    if (!player) continue;
    const list = grouped.get(row.fantasy_team_id as string) ?? [];
    list.push(player);
    grouped.set(row.fantasy_team_id as string, list);
  }
  return [...grouped.entries()].map(([id, roster]) => {
    const lineup = autoLineup(roster);
    const slots: LineupSlotInput[] = [];
    if (lineup) {
      lineup.playerIds.forEach((playerId) => {
        const player = roster.find((item) => item.id === playerId);
        slots.push({
          playerId,
          role: player?.role,
          isCaptain: playerId === lineup.captainId,
          isVice: playerId === lineup.viceId,
        });
      });
      lineup.benchIds.forEach((playerId, index) => {
        const player = roster.find((item) => item.id === playerId);
        slots.push({
          playerId,
          role: player?.role,
          isCaptain: false,
          isVice: false,
          benchOrder: index + 1,
        });
      });
    }
    return { id, name: nameOf.get(id) ?? id, slots, roster };
  });
}
