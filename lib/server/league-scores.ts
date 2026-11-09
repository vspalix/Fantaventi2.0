import { scoreLineup, type LineupSlotInput, type PlayerStat, type RulesetDefinition } from "@/lib/engine/calculator";
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
    .select("player_id, role, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId);
  if (registrationError) throw new Error(registrationError.message);

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
    for (const row of registrations ?? []) {
      const from = row.effective_from_gameweek as number;
      const until = row.effective_to_gameweek as number | null;
      if (from > number || (until !== null && until < number)) continue;
      roles.set(row.player_id as string, row.role as PlayerRole);
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
    const score = scoreLineup(lineup.fantasy_team_id as string, slots, stats, definition);
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
