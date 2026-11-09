import type { SupabaseClient } from "@supabase/supabase-js";
import { openCheckpoint, rosterChangeCount, sharedPlayerIds, type LeagueRules } from "@/lib/league-rules";
import { readLeagueSettings } from "@/lib/server/league-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { rosterAppliesFrom } from "@/lib/server/gameweek-cycle";
import { MATCH_CLOSE_MS } from "@/lib/server/match-window";
import { ensureFantasyTeam, ensureProfile, getCurrentSeason, getFantasyTeam } from "@/lib/server/catalog";
import type { RosterMarket } from "@/lib/types";

const MATCH_WINDOW_MS = MATCH_CLOSE_MS;

const OPEN_MARKET: RosterMarket = { locked: false, gameweekNumber: null, message: null };

type StintRow = {
  id: string;
  fantasy_team_id: string;
  player_id: string;
  active_from_gameweek: number;
  active_until_gameweek: number | null;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function missingRelation(message: string) {
  return /schema cache|could not find|does not exist|42P01/i.test(message);
}

type MatchClock = {
  gameweekNumber: number;
  kickoff: number;
  status: "scheduled" | "locked" | "live" | "finished" | null;
};

function matchIsOver(match: MatchClock, now: number) {
  if (match.status === "finished") return true;
  if (match.status === "live" || match.status === "locked") return false;
  return now >= match.kickoff + MATCH_WINDOW_MS;
}

async function matchClocks(admin: SupabaseClient, seasonId: string) {
  const { data: weeks, error: weekError } = await admin
    .from("gameweeks")
    .select("id, number")
    .eq("season_id", seasonId);
  if (weekError) throw new Error(weekError.message);
  const numberById = new Map((weeks ?? []).map((row) => [row.id as string, row.number as number]));
  const weekIds = [...numberById.keys()];
  const matches: MatchClock[] = [];
  let source: "matches" | "fixtures" = "fixtures";
  if (weekIds.length === 0) return { matches, source, numberById };

  const real = await admin
    .from("real_matches")
    .select("gameweek_id, kickoff_at, status")
    .in("gameweek_id", weekIds);
  if (real.error && !missingRelation(real.error.message)) throw new Error(real.error.message);
  if (!real.error && (real.data ?? []).length > 0) {
    source = "matches";
    for (const row of real.data ?? []) {
      const kickoff = new Date(row.kickoff_at as string).getTime();
      const gameweekNumber = numberById.get(row.gameweek_id as string);
      const status = row.status as MatchClock["status"];
      if (!gameweekNumber || !Number.isFinite(kickoff)) continue;
      matches.push({ gameweekNumber, kickoff, status });
    }
  } else {
    const fixtures = await admin
      .from("external_fixtures")
      .select("gameweek_number, kickoff_at")
      .eq("season_id", seasonId);
    if (fixtures.error && !missingRelation(fixtures.error.message)) throw new Error(fixtures.error.message);
    for (const row of fixtures.data ?? []) {
      const kickoff = new Date(row.kickoff_at as string).getTime();
      if (!Number.isFinite(kickoff)) continue;
      matches.push({
        gameweekNumber: row.gameweek_number as number,
        kickoff,
        status: null,
      });
    }
  }
  return { matches, source, numberById };
}

function weeksInPlay(matches: MatchClock[], now: number) {
  const byWeek = new Map<number, MatchClock[]>();
  for (const match of matches) {
    const list = byWeek.get(match.gameweekNumber) ?? [];
    list.push(match);
    byWeek.set(match.gameweekNumber, list);
  }
  const active = new Set<number>();
  for (const [gameweekNumber, weekMatches] of byWeek) {
    const firstKickoff = Math.min(...weekMatches.map((match) => match.kickoff));
    if (now >= firstKickoff && weekMatches.some((match) => !matchIsOver(match, now))) {
      active.add(gameweekNumber);
    }
  }
  return { byWeek, active };
}

export type WeekMatchState = {
  inPlay: Set<number>;
  withMatches: Set<number>;
  finished: Set<number>;
};

export async function loadWeekMatchState(admin: SupabaseClient, seasonId: string, now = Date.now()): Promise<WeekMatchState> {
  const { matches } = await matchClocks(admin, seasonId);
  const { byWeek, active } = weeksInPlay(matches, now);
  const withMatches = new Set<number>();
  const finished = new Set<number>();
  for (const [gameweekNumber, weekMatches] of byWeek) {
    withMatches.add(gameweekNumber);
    if (weekMatches.every((match) => matchIsOver(match, now))) finished.add(gameweekNumber);
  }
  return { inPlay: active, withMatches, finished };
}

export async function inPlayGameweeks(admin: SupabaseClient, seasonId: string, now = Date.now()) {
  return (await loadWeekMatchState(admin, seasonId, now)).inPlay;
}

export async function loadRosterMarket(admin: SupabaseClient, seasonId: string, now = Date.now()): Promise<RosterMarket> {
  const { matches, source } = await matchClocks(admin, seasonId);
  if (matches.length === 0) return OPEN_MARKET;

  const { byWeek, active: activeNumbers } = weeksInPlay(matches, now);
  const active = [...byWeek.entries()].filter(([gameweekNumber]) => activeNumbers.has(gameweekNumber))
    .sort((left, right) => left[0] - right[0])
    .find(([, weekMatches]) => {
      const firstKickoff = Math.min(...weekMatches.map((match) => match.kickoff));
      return now >= firstKickoff && weekMatches.some((match) => !matchIsOver(match, now));
    });
  if (!active) return OPEN_MARKET;

  const [gameweekNumber] = active;
  const message = source === "matches"
    ? `Giornata ${gameweekNumber} in corso. Acquisti, cessioni e cambi sono bloccati dal calcio d'inizio della prima partita fino al fischio finale dell'ultima.`
    : `Giornata ${gameweekNumber} in corso. Acquisti, cessioni e cambi sono bloccati dal primo calcio d'inizio fino a due ore dopo l'ultimo: il calendario non registra il fischio finale.`;
  return { locked: true, gameweekNumber, message };
}

async function restoreStints(admin: SupabaseClient, teamId: string, previous: StintRow[]) {
  await admin.from("roster_stints").delete().eq("fantasy_team_id", teamId);
  if (previous.length === 0) return;
  const { error } = await admin.from("roster_stints").insert(previous);
  if (error) throw new Error(error.message);
}

function covers(stint: StintRow, gameweek: number) {
  return stint.active_from_gameweek <= gameweek
    && (stint.active_until_gameweek === null || stint.active_until_gameweek >= gameweek);
}

export async function loadRoster(userId: string) {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const team = await getFantasyTeam(admin, userId, season.id);
  const market = await loadRosterMarket(admin, season.id);
  const appliesFrom = await rosterAppliesFrom(admin, season.id);
  if (!team) return { teamId: null, teamName: "", playerIds: [] as string[], appliesFrom, market };

  const { data, error } = await admin
    .from("roster_stints")
    .select("player_id")
    .eq("fantasy_team_id", team.id)
    .is("active_until_gameweek", null);
  if (error) throw new Error(error.message);

  return {
    teamId: team.id,
    teamName: team.name,
    playerIds: (data ?? []).map((row) => row.player_id as string),
    appliesFrom,
    market,
  };
}

export async function saveRoster(userId: string, email: string | undefined, teamName: string, playerIds: string[]) {
  const trimmed = teamName.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw new Error("Il nome squadra deve avere tra 2 e 40 caratteri.");
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("La rosa contiene un calciatore ripetuto.");
  }
  const { assertWritesOpen } = await import("@/lib/server/maintenance");
  await assertWritesOpen();

  const admin = createAdminSupabase();
  await ensureProfile(admin, userId, email);
  const season = await getCurrentSeason(admin);
  const market = await loadRosterMarket(admin, season.id);
  if (market.locked && market.message) throw httpError(market.message, 409);
  const teamId = await ensureFantasyTeam(admin, userId, season.id, trimmed);
  const gameweek = await rosterAppliesFrom(admin, season.id);

  const { data: previousRows, error: previousError } = await admin
    .from("roster_stints")
    .select("id, fantasy_team_id, player_id, active_from_gameweek, active_until_gameweek")
    .eq("fantasy_team_id", teamId);
  if (previousError) throw new Error(previousError.message);
  const previous = (previousRows ?? []) as StintRow[];
  const beforeIds = previous.filter((stint) => covers(stint, gameweek)).map((stint) => stint.player_id);
  const before = new Set(beforeIds);
  const changed = before.size !== playerIds.length || playerIds.some((playerId) => !before.has(playerId));
  const changes = rosterChangeCount(beforeIds, playerIds);
  const checkpoint = changed ? await assertRosterMarket(admin, teamId, season.id, playerIds, changes) : null;

  try {
    await writeRosterFrom(admin, teamId, playerIds, gameweek, previous);
  } catch (error) {
    await restoreStints(admin, teamId, previous);
    throw error;
  }

  const { error: validationError } = await admin.rpc("validate_fantasy_team_roster", {
    p_fantasy_team_id: teamId,
    p_gameweek: gameweek,
  });

  if (validationError) {
    await restoreStints(admin, teamId, previous);
    throw new Error(validationError.message);
  }

  if (checkpoint && changes > 0) {
    await recordCheckpointUse(admin, teamId, checkpoint.afterMatchday, changes);
    try {
      const { recordMarketFeed } = await import("@/lib/server/league-feed");
      await recordMarketFeed({
        userId,
        teamId,
        seasonId: season.id,
        beforeIds,
        playerIds,
        afterMatchday: checkpoint.afterMatchday,
      });
    } catch {
      // La rosa è già salva: la bacheca può arrivare al giro dopo.
    }
  }
  if (changed) await clearOpenLineups(admin, season.id, teamId, gameweek);

  const { data: ownedLeagues, error: ownedError } = await admin
    .from("private_leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("season_id", season.id);
  if (ownedError) throw new Error(ownedError.message);

  if ((ownedLeagues ?? []).length > 0) {
    const { error: memberError } = await admin.from("private_league_members").upsert(
      (ownedLeagues ?? []).map((league) => ({
        private_league_id: league.id as string,
        fantasy_team_id: teamId,
      })),
      { onConflict: "private_league_id,fantasy_team_id", ignoreDuplicates: true },
    );
    if (memberError) throw new Error(memberError.message);
  }

  return { teamId, teamName: trimmed, playerIds, appliesFrom: gameweek, gameweek };
}

async function assertRosterMarket(
  admin: SupabaseClient,
  teamId: string,
  seasonId: string,
  playerIds: string[],
  changes: number,
) {
  const memberships = await admin.from("private_league_members").select("private_league_id").eq("fantasy_team_id", teamId);
  if (memberships.error) throw new Error(memberships.error.message);
  const leagueIds = (memberships.data ?? []).map((row) => row.private_league_id as string);
  const leagues: { id: string; rules: LeagueRules }[] = [];
  for (const leagueId of leagueIds) {
    const settings = await readLeagueSettings(admin, leagueId);
    if (settings.ready) leagues.push({ id: leagueId, rules: settings.rules });
  }
  await assertExclusiveRosters(admin, teamId, leagues, playerIds);

  const gated = leagues.filter((league) => league.rules.checkpoints.length > 0);
  if (gated.length === 0 || changes === 0) return null;
  const closedWeeks = await admin
    .from("gameweeks")
    .select("number")
    .eq("season_id", seasonId)
    .in("status", ["scored", "final"]);
  if (closedWeeks.error) throw new Error(closedWeeks.error.message);
  const closed = (closedWeeks.data ?? []).map((row) => row.number as number);
  if (closed.length === 0) return null;

  const windows = gated.map((league) => openCheckpoint(league.rules.checkpoints, closed));
  if (windows.some((window) => window === null)) {
    throw httpError("Il mercato cambi è chiuso. Si riapre solo nel checkpoint definito dalla lega, dopo la giornata indicata e prima della successiva.", 409);
  }
  const open = windows.filter((window): window is NonNullable<typeof window> => window !== null);
  const afterMatchday = open[0]?.afterMatchday;
  if (!afterMatchday || open.some((window) => window.afterMatchday !== afterMatchday)) {
    throw httpError("I checkpoint aperti delle tue leghe non coincidono: il cambio resta fermo.", 409);
  }
  const allowance = Math.min(...open.map((window) => window.changes));
  const used = await admin
    .from("roster_checkpoint_uses")
    .select("changes_used")
    .eq("fantasy_team_id", teamId)
    .eq("after_matchday", afterMatchday)
    .maybeSingle();
  if (used.error) {
    if (/roster_checkpoint_uses|schema cache|could not find|relation/i.test(used.error.message)) {
      throw httpError("Per contare i cambi esegui platform_override.sql nell'editor SQL di Supabase.", 409);
    }
    throw new Error(used.error.message);
  }
  const already = Number(used.data?.changes_used ?? 0);
  if (already + changes > allowance) {
    throw httpError(`In questo checkpoint restano ${Math.max(0, allowance - already)} cambi. Ne stai chiedendo ${changes}.`, 409);
  }
  return { afterMatchday };
}

async function assertExclusiveRosters(
  admin: SupabaseClient,
  teamId: string,
  leagues: { id: string; rules: LeagueRules }[],
  playerIds: string[],
) {
  for (const league of leagues) {
    if (!league.rules.exclusiveRosters) continue;
    const members = await admin
      .from("private_league_members")
      .select("fantasy_team_id")
      .eq("private_league_id", league.id);
    if (members.error) throw new Error(members.error.message);
    const otherIds = (members.data ?? [])
      .map((row) => row.fantasy_team_id as string)
      .filter((id) => id !== teamId);
    if (otherIds.length === 0) continue;
    const stints = await admin
      .from("roster_stints")
      .select("player_id")
      .in("fantasy_team_id", otherIds)
      .is("active_until_gameweek", null);
    if (stints.error) throw new Error(stints.error.message);
    const clash = sharedPlayerIds(playerIds, [(stints.data ?? []).map((row) => row.player_id as string)]);
    if (clash.length > 0) {
      throw httpError("In questa lega le rose sono esclusive: un calciatore non può stare in due squadre.", 409);
    }
  }
}

async function recordCheckpointUse(admin: SupabaseClient, teamId: string, afterMatchday: number, changes: number) {
  const current = await admin
    .from("roster_checkpoint_uses")
    .select("changes_used")
    .eq("fantasy_team_id", teamId)
    .eq("after_matchday", afterMatchday)
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const changesUsed = Number(current.data?.changes_used ?? 0) + changes;
  const saved = await admin.from("roster_checkpoint_uses").upsert({
    fantasy_team_id: teamId,
    after_matchday: afterMatchday,
    changes_used: changesUsed,
  }, { onConflict: "fantasy_team_id,after_matchday" });
  if (saved.error) throw new Error(saved.error.message);
}

async function writeRosterFrom(
  admin: SupabaseClient,
  teamId: string,
  playerIds: string[],
  gameweek: number,
  previous: StintRow[],
) {
  const hasHistory = previous.some((stint) => stint.active_from_gameweek < gameweek);
  if (!hasHistory) {
    const { error: deleteError } = await admin.from("roster_stints").delete().eq("fantasy_team_id", teamId);
    if (deleteError) throw new Error(deleteError.message);
    if (playerIds.length === 0) return;
    const { error: insertError } = await admin.from("roster_stints").insert(
      playerIds.map((playerId) => ({
        id: crypto.randomUUID(),
        fantasy_team_id: teamId,
        player_id: playerId,
        active_from_gameweek: gameweek,
        active_until_gameweek: null,
      })),
    );
    if (insertError) throw new Error(insertError.message);
    return;
  }

  const wanted = new Set(playerIds);
  const covering = new Set(previous.filter((stint) => covers(stint, gameweek)).map((stint) => stint.player_id));

  for (const stint of previous) {
    if (wanted.has(stint.player_id)) continue;
    if (stint.active_from_gameweek >= gameweek) {
      const { error } = await admin.from("roster_stints").delete().eq("id", stint.id);
      if (error) throw new Error(error.message);
    } else if (covers(stint, gameweek)) {
      const { error } = await admin
        .from("roster_stints")
        .update({ active_until_gameweek: gameweek - 1 })
        .eq("id", stint.id);
      if (error) throw new Error(error.message);
    }
  }

  const incoming = playerIds.filter((playerId) => !covering.has(playerId));
  if (incoming.length === 0) return;
  const { error: insertError } = await admin.from("roster_stints").insert(
    incoming.map((playerId) => ({
      id: crypto.randomUUID(),
      fantasy_team_id: teamId,
      player_id: playerId,
      active_from_gameweek: gameweek,
      active_until_gameweek: null,
    })),
  );
  if (insertError) throw new Error(insertError.message);
}

async function clearOpenLineups(
  admin: SupabaseClient,
  seasonId: string,
  teamId: string,
  gameweek: number,
) {
  const { data, error } = await admin
    .from("gameweeks")
    .select("id")
    .eq("season_id", seasonId)
    .gte("number", gameweek)
    .in("status", ["scheduled", "open"]);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length === 0) return;
  const { error: lineupError } = await admin
    .from("lineups")
    .delete()
    .eq("fantasy_team_id", teamId)
    .eq("status", "draft")
    .in("gameweek_id", ids);
  if (lineupError) throw new Error(lineupError.message);
}
