import { scoreLineup, type LineupSlotInput, type PlayerStat, type RulesetDefinition } from "@/lib/engine/calculator";
import { holeIdsKeepingHeldPlayers, isHeldMatch } from "@/lib/server/held-lineup";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { waitingWeek } from "@/lib/late-entry";
import { definitionForLeague } from "@/lib/server/league-settings";
import { inChunks, readAllRows } from "@/lib/server/read-all";
import type { PlayerRole } from "@/lib/types";

type SlotRow = {
  lineup_id?: string;
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
  is_starter?: boolean;
  slot_order?: number;
};

/** La prima giornata schierata da ogni squadra e le giornate coperte, tra quelle indicate. */
export async function leagueEntries(teamIds: string[], gameweeks: { id: string; number: number }[]) {
  const entryByTeam = new Map<string, number>();
  const fielded = new Set<string>();
  if (teamIds.length === 0 || gameweeks.length === 0) return { entryByTeam, fielded };
  const admin = createAdminSupabase();
  const numberById = new Map(gameweeks.map((week) => [week.id, week.number]));
  const { data, error } = await readAllRows((from, to) => admin
    .from("lineups")
    .select("fantasy_team_id, gameweek_id")
    .in("fantasy_team_id", teamIds)
    .in("gameweek_id", [...numberById.keys()])
    .order("id")
    .range(from, to));
  if (error) throw new Error(error.message);
  for (const row of data) {
    const teamId = row.fantasy_team_id as string;
    const number = numberById.get(row.gameweek_id as string);
    if (number === undefined) continue;
    fielded.add(`${teamId}:${row.gameweek_id as string}`);
    const current = entryByTeam.get(teamId);
    if (current === undefined || number < current) entryByTeam.set(teamId, number);
  }
  return { entryByTeam, fielded };
}

/** Per chi non ha ancora schierato: da quale giornata gioca (vedi `waitingWeek`). */
export async function waitingEntries(
  teamIds: string[],
  entryByTeam: ReadonlyMap<string, number>,
  gameweeks: { number: number; deadlineAt: string }[],
  startMatchday: number,
  now = Date.now(),
) {
  const waiting = new Map<string, number>();
  const missing = teamIds.filter((teamId) => !entryByTeam.has(teamId));
  if (missing.length === 0 || gameweeks.length === 0) return waiting;
  const { data, error } = await readAllRows((from, to) => createAdminSupabase()
    .from("roster_stints")
    .select("fantasy_team_id, active_from_gameweek, active_until_gameweek")
    .in("fantasy_team_id", missing)
    .order("id")
    .range(from, to));
  if (error) throw new Error(error.message);
  const numbers = gameweeks.map((week) => week.number);
  const open = gameweeks.filter((week) => new Date(week.deadlineAt).getTime() > now).map((week) => week.number);
  const nextOpen = open.length > 0 ? Math.min(...open) : Math.max(...numbers) + 1;
  for (const teamId of missing) {
    // Le righe di rosa finite prima dell'inizio della lega non contano.
    const starts = data
      .filter((row) => row.fantasy_team_id === teamId
        && (row.active_until_gameweek === null || Number(row.active_until_gameweek) >= startMatchday))
      .map((row) => Number(row.active_from_gameweek));
    const week = waitingWeek(starts.length > 0 ? Math.min(...starts) : null, nextOpen, startMatchday);
    if (week !== null) waiting.set(teamId, week);
  }
  return waiting;
}

export async function fantasyPointsForLeague(
  leagueId: string,
  seasonId: string,
  teamIds: string[],
  gameweeks: { id: string; number: number }[],
) {
  if (teamIds.length === 0 || gameweeks.length === 0) return new Map<string, number>();
  const admin = createAdminSupabase();
  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("rulesets(definition)")
    .eq("id", seasonId)
    .single();
  if (seasonError) throw new Error(seasonError.message);
  const ruleset = Array.isArray(season.rulesets) ? season.rulesets[0] : season.rulesets;
  const { rules, definition } = await definitionForLeague(admin, leagueId, (ruleset?.definition ?? {}) as RulesetDefinition);

  const gameweekIds = gameweeks.map((week) => week.id);
  const numberById = new Map(gameweeks.map((week) => [week.id, week.number]));
  // Le formazioni, le loro righe e i voti di una stagione superano il limite di una sola richiesta.
  const lineupsWith = (columns: string) => readAllRows<{ id: string; fantasy_team_id: string; gameweek_id: string; origin?: string }>((from, to) => admin
    .from("lineups")
    .select(columns)
    .in("fantasy_team_id", teamIds)
    .in("gameweek_id", gameweekIds)
    .order("id")
    .range(from, to)
    .returns<{ id: string; fantasy_team_id: string; gameweek_id: string; origin?: string }[]>());
  const extendedLineups = await lineupsWith("id, fantasy_team_id, gameweek_id, origin");
  const lineupQuery = extendedLineups.error && /origin|schema cache|could not find/i.test(extendedLineups.error.message)
    ? await lineupsWith("id, fantasy_team_id, gameweek_id")
    : extendedLineups;
  if (lineupQuery.error) throw new Error(lineupQuery.error.message);
  const lineupRows = lineupQuery.data;

  const lineupIds = (lineupRows ?? []).map((row) => row.id as string);
  const slotsWith = async (columns: string) => {
    const parts = await Promise.all(inChunks(lineupIds).map((ids) => readAllRows<SlotRow>((from, to) => admin
      .from("lineup_slots")
      .select(columns)
      .in("lineup_id", ids)
      .order("lineup_id")
      .order("player_id")
      .range(from, to)
      .returns<SlotRow[]>())));
    return { data: parts.flatMap((part) => part.data), error: parts.find((part) => part.error)?.error ?? null };
  };
  const extended = await slotsWith("lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order");
  const slotsQuery = extended.error && /is_starter|slot_order/i.test(extended.error.message)
    ? await slotsWith("lineup_id, player_id, is_captain, is_vice_captain")
    : extended;
  if (slotsQuery.error) throw new Error(slotsQuery.error.message);

  const { data: statRows, error: statError } = await readAllRows((from, to) => admin
    .from("player_gameweek_stats")
    .select("gameweek_id, player_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals, goals_conceded")
    .in("gameweek_id", gameweekIds)
    .order("id")
    .range(from, to));
  if (statError) throw new Error(statError.message);

  const { data: registrations, error: registrationError } = await readAllRows((from, to) => admin
    .from("player_registrations")
    .select("player_id, club_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId)
    .order("id")
    .range(from, to));
  if (registrationError) throw new Error(registrationError.message);

  const heldByWeek = await heldClubsByWeek(gameweekIds);
  const slotsByLineup = new Map<string, SlotRow[]>();
  for (const slot of (slotsQuery.data ?? []) as SlotRow[]) {
    const lineupId = slot.lineup_id ?? "";
    const list = slotsByLineup.get(lineupId) ?? [];
    list.push(slot);
    slotsByLineup.set(lineupId, list);
  }

  type RegistrationRow = {
    player_id: string;
    club_id: string;
    role: PlayerRole;
    effective_from_gameweek: number;
    effective_to_gameweek: number | null;
  };
  const registrationRows = (registrations ?? []) as RegistrationRow[];
  const roleCache = new Map<number, { roles: Map<string, PlayerRole>; clubs: Map<string, string> }>();
  function rosterAt(number: number) {
    const cached = roleCache.get(number);
    if (cached) return cached;
    const roles = new Map<string, PlayerRole>();
    const clubs = new Map<string, string>();
    for (const row of registrationRows) {
      const from = Number(row.effective_from_gameweek);
      const until = row.effective_to_gameweek == null ? null : Number(row.effective_to_gameweek);
      if (from > number || (until !== null && until < number)) continue;
      roles.set(row.player_id, row.role);
      clubs.set(row.player_id, row.club_id);
    }
    const built = { roles, clubs };
    roleCache.set(number, built);
    return built;
  }

  type StatRow = {
    gameweek_id: string;
    player_id: string;
    voto: number | string | null;
    goals: number | null;
    assists: number | null;
    yellow_cards: number | null;
    red_cards: number | null;
    penalties_scored: number | null;
    penalties_missed: number | null;
    penalties_saved: number | null;
    own_goals: number | null;
    goals_conceded: number | null;
  };
  const statsByWeek = new Map<string, StatRow[]>();
  for (const row of (statRows ?? []) as StatRow[]) {
    const list = statsByWeek.get(row.gameweek_id) ?? [];
    list.push(row);
    statsByWeek.set(row.gameweek_id, list);
  }

  const points = new Map<string, number>();
  for (const lineup of lineupRows ?? []) {
    const gameweekId = lineup.gameweek_id as string;
    const number = numberById.get(gameweekId);
    if (number === undefined) continue;
    const { roles, clubs: clubByPlayer } = rosterAt(number);
    const stats = new Map<string, PlayerStat>();
    for (const row of statsByWeek.get(gameweekId) ?? []) {
      const playerId = row.player_id;
      stats.set(playerId, {
        playerId,
        role: roles.get(playerId) ?? "MID",
        voto: row.voto == null ? null : Number(row.voto),
        goals: Number(row.goals ?? 0),
        assists: Number(row.assists ?? 0),
        yellowCards: Number(row.yellow_cards ?? 0),
        redCards: Number(row.red_cards ?? 0),
        penaltiesScored: Number(row.penalties_scored ?? 0),
        penaltiesMissed: Number(row.penalties_missed ?? 0),
        penaltiesSaved: Number(row.penalties_saved ?? 0),
        ownGoals: Number(row.own_goals ?? 0),
        goalsConceded: Number(row.goals_conceded ?? 0),
      });
    }
    const slots: LineupSlotInput[] = (slotsByLineup.get(lineup.id as string) ?? []).map((slot) => ({
      playerId: slot.player_id,
      isCaptain: Boolean(slot.is_captain) && slot.is_starter !== false,
      isVice: Boolean(slot.is_vice_captain) && slot.is_starter !== false,
      role: roles.get(slot.player_id),
      benchOrder: slot.is_starter === false ? Number(slot.slot_order ?? 0) : undefined,
    }));
    const held = heldByWeek.get(gameweekId);
    if (held && held.size > 0) {
      for (const slot of slots) {
        const clubId = clubByPlayer.get(slot.playerId);
        if (!clubId || !held.has(clubId)) continue;
        const current = stats.get(slot.playerId);
        stats.set(slot.playerId, {
          playerId: slot.playerId,
          role: slot.role ?? current?.role ?? "MID",
          voto: null,
          goals: 0,
          assists: 0,
          yellowCards: 0,
          redCards: 0,
          penaltiesScored: 0,
          penaltiesMissed: 0,
          penaltiesSaved: 0,
          ownGoals: 0,
          goalsConceded: 0,
          postponed: true,
        });
      }
    }
    const score = scoreLineup(
      lineup.fantasy_team_id as string,
      slots,
      stats,
      definition,
      holeIdsKeepingHeldPlayers(slots, stats, definition.lineup_size ?? 11),
    );
    const officePenalty = rules.missedLineup === "penalty" && (lineup as { origin?: string }).origin === "office";
    points.set(`${lineup.fantasy_team_id as string}:${gameweekId}`, officePenalty ? rules.missedLineupPenalty : score.total);
  }
  if (rules.missedLineup === "penalty") {
    for (const teamId of teamIds) {
      for (const week of gameweeks) {
        const key = `${teamId}:${week.id}`;
        if (!points.has(key)) points.set(key, rules.missedLineupPenalty);
      }
    }
  }
  return points;
}

async function heldClubsByWeek(gameweekIds: string[]) {
  const map = new Map<string, Set<string>>();
  if (gameweekIds.length === 0) return map;
  const admin = createAdminSupabase();
  const withHold = await admin
    .from("real_matches")
    .select("gameweek_id, home_club_id, away_club_id, postponed, hold_status")
    .in("gameweek_id", gameweekIds);
  const plain = withHold.error && /hold_status|schema cache|could not find/i.test(withHold.error.message)
    ? await admin.from("real_matches").select("gameweek_id, home_club_id, away_club_id, postponed").in("gameweek_id", gameweekIds)
    : withHold;
  if (plain.error) return map;
  for (const row of plain.data ?? []) {
    if (!isHeldMatch(row)) continue;
    const weekId = row.gameweek_id as string;
    const clubs = map.get(weekId) ?? new Set<string>();
    clubs.add(row.home_club_id as string);
    clubs.add(row.away_club_id as string);
    map.set(weekId, clubs);
  }
  return map;
}
