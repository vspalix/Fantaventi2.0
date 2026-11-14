import { scoreLineup, type LineupSlotInput, type PlayerStat, type RulesetDefinition } from "@/lib/engine/calculator";
import { holeIdsKeepingHeldPlayers, isHeldMatch } from "@/lib/server/held-lineup";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { definitionForLeague } from "@/lib/server/league-settings";
import type { PlayerRole } from "@/lib/types";

type SlotRow = {
  lineup_id?: string;
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
  is_starter?: boolean;
  slot_order?: number;
};

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
  const extendedLineups = await admin
    .from("lineups")
    .select("id, fantasy_team_id, gameweek_id, origin")
    .in("fantasy_team_id", teamIds)
    .in("gameweek_id", gameweekIds);
  const lineupQuery = extendedLineups.error && /origin|schema cache|could not find/i.test(extendedLineups.error.message)
    ? await admin.from("lineups").select("id, fantasy_team_id, gameweek_id").in("fantasy_team_id", teamIds).in("gameweek_id", gameweekIds)
    : extendedLineups;
  if (lineupQuery.error) throw new Error(lineupQuery.error.message);
  const lineupRows = lineupQuery.data;

  const lineupIds = (lineupRows ?? []).map((row) => row.id as string);
  const extended = lineupIds.length
    ? await admin.from("lineup_slots").select("lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order").in("lineup_id", lineupIds)
    : { data: [], error: null };
  const slotsQuery = extended.error && /is_starter|slot_order/i.test(extended.error.message)
    ? await admin.from("lineup_slots").select("lineup_id, player_id, is_captain, is_vice_captain").in("lineup_id", lineupIds)
    : extended;
  if (slotsQuery.error) throw new Error(slotsQuery.error.message);

  const { data: statRows, error: statError } = await admin
    .from("player_gameweek_stats")
    .select("gameweek_id, player_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals, goals_conceded")
    .in("gameweek_id", gameweekIds);
  if (statError) throw new Error(statError.message);

  const { data: registrations, error: registrationError } = await admin
    .from("player_registrations")
    .select("player_id, club_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId);
  if (registrationError) throw new Error(registrationError.message);

  const heldByWeek = await heldClubsByWeek(gameweekIds);
  const slotsByLineup = new Map<string, SlotRow[]>();
  for (const slot of (slotsQuery.data ?? []) as SlotRow[]) {
    const lineupId = slot.lineup_id ?? "";
    const list = slotsByLineup.get(lineupId) ?? [];
    list.push(slot);
    slotsByLineup.set(lineupId, list);
  }

  const points = new Map<string, number>();
  for (const lineup of lineupRows ?? []) {
    const gameweekId = lineup.gameweek_id as string;
    const number = numberById.get(gameweekId);
    if (number === undefined) continue;
    const roles = new Map<string, PlayerRole>();
    const clubByPlayer = new Map<string, string>();
    for (const row of registrations ?? []) {
      const from = row.effective_from_gameweek as number;
      const until = row.effective_to_gameweek as number | null;
      if (from > number || (until !== null && until < number)) continue;
      roles.set(row.player_id as string, row.role as PlayerRole);
      clubByPlayer.set(row.player_id as string, row.club_id as string);
    }
    const stats = new Map<string, PlayerStat>();
    for (const row of statRows ?? []) {
      if (row.gameweek_id !== gameweekId) continue;
      const playerId = row.player_id as string;
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
