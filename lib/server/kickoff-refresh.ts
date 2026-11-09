import { getCurrentSeason } from "@/lib/server/catalog";
import { deadlineFromKickoff } from "@/lib/server/serie-a-calendar";
import { fetchSkyCalendar, romeLocalToIso } from "@/lib/server/sky-calendar";
import { schemaHint } from "@/lib/server/live-score";
import { createAdminSupabase } from "@/lib/supabase/admin";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER = "sky-serie-a";

type StoredMatch = {
  id: string;
  gameweekId: string;
  gameweekNumber: number;
  home: string;
  away: string;
  kickoffAt: string;
  status: string;
  kickoffLocked: boolean;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

async function assertSeasonOwner(
  admin: ReturnType<typeof createAdminSupabase>,
  userId: string,
  seasonId: string,
) {
  const { data, error } = await admin
    .from("private_leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("season_id", seasonId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw httpError("Solo il proprietario di una lega di questa stagione può aggiornare gli orari.", 403);
  }
}

async function lastRefreshAt(admin: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const { data, error } = await admin
    .from("calendar_sync_runs")
    .select("created_at")
    .eq("season_id", seasonId)
    .eq("provider", PROVIDER)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    if (/calendar_sync_runs|schema cache|could not find/i.test(error.message)) return { at: null, logged: false };
    throw new Error(error.message);
  }
  const created = data?.[0]?.created_at as string | undefined;
  return { at: created ? new Date(created).getTime() : null, logged: true };
}

async function rememberRefresh(
  admin: ReturnType<typeof createAdminSupabase>,
  seasonId: string,
  summary: { rounds: number; fixtures: number; updated: number },
) {
  const { error } = await admin.from("calendar_sync_runs").insert({
    season_id: seasonId,
    provider: PROVIDER,
    save_mode: "automatic",
    status: "applied",
    payload: summary,
    applied_at: new Date().toISOString(),
  });
  if (error && !/calendar_sync_runs|schema cache|could not find|save_mode|calendar_save_mode/i.test(error.message)) {
    throw new Error(error.message);
  }
  return !error;
}

async function manualDeadlines(admin: ReturnType<typeof createAdminSupabase>, gameweekIds: string[]) {
  const manual = new Set<string>();
  if (gameweekIds.length === 0) return { manual, ready: true };
  const overrides = await admin.from("gameweek_overrides").select("gameweek_id, deadline_at").in("gameweek_id", gameweekIds);
  if (overrides.error) {
    if (/gameweek_overrides|schema cache|could not find/i.test(overrides.error.message)) {
      return { manual, ready: false };
    }
    throw new Error(overrides.error.message);
  }
  for (const row of overrides.data ?? []) {
    if (row.deadline_at) manual.add(row.gameweek_id as string);
  }
  return { manual, ready: true };
}

async function loadStoredMatches(admin: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const { data: weeks, error: weekError } = await admin
    .from("gameweeks")
    .select("id, number, status")
    .eq("season_id", seasonId);
  if (weekError) throw new Error(weekError.message);
  const weekById = new Map((weeks ?? []).map((week) => [week.id as string, week]));
  const weekIds = [...weekById.keys()];
  if (weekIds.length === 0) throw httpError("Mancano le giornate. Esegui calendar_setup.sql.", 409);

  const withLock = await admin
    .from("real_matches")
    .select("id, gameweek_id, kickoff_at, status, home_club_id, away_club_id, kickoff_locked")
    .in("gameweek_id", weekIds);
  const lockColumn = !withLock.error || !/kickoff_locked/i.test(withLock.error.message);
  const listed = lockColumn
    ? withLock
    : await admin
      .from("real_matches")
      .select("id, gameweek_id, kickoff_at, status, home_club_id, away_club_id")
      .in("gameweek_id", weekIds);
  if (listed.error) throw new Error(schemaHint(listed.error.message));

  const clubIds = [...new Set((listed.data ?? []).flatMap((row) => [row.home_club_id as string, row.away_club_id as string]))];
  const clubs = clubIds.length
    ? await admin.from("clubs").select("id, code").in("id", clubIds)
    : { data: [], error: null };
  if (clubs.error) throw new Error(clubs.error.message);
  const codes = new Map((clubs.data ?? []).map((club) => [club.id as string, club.code as string]));

  const matches: StoredMatch[] = [];
  for (const row of listed.data ?? []) {
    const week = weekById.get(row.gameweek_id as string);
    if (!week) continue;
    matches.push({
      id: row.id as string,
      gameweekId: row.gameweek_id as string,
      gameweekNumber: week.number as number,
      home: codes.get(row.home_club_id as string) ?? "",
      away: codes.get(row.away_club_id as string) ?? "",
      kickoffAt: row.kickoff_at as string,
      status: row.status as string,
      kickoffLocked: lockColumn && Boolean((row as { kickoff_locked?: boolean }).kickoff_locked),
    });
  }
  return {
    matches,
    weeks: [...weekById.values()] as { id: string; number: number; status: string }[],
    lockColumn,
  };
}

async function refreshDeadlines(
  admin: ReturnType<typeof createAdminSupabase>,
  weeks: { id: string; number: number; status: string }[],
  matches: StoredMatch[],
  onlyWeekIds?: ReadonlySet<string>,
) {
  const selected = onlyWeekIds ? weeks.filter((week) => onlyWeekIds.has(week.id)) : weeks;
  const { manual } = await manualDeadlines(admin, selected.map((week) => week.id));
  let deadlines = 0;
  for (const week of selected) {
    if (week.status !== "scheduled" || manual.has(week.id)) continue;
    const kickoffs = matches
      .filter((match) => match.gameweekId === week.id)
      .map((match) => new Date(match.kickoffAt).getTime())
      .filter((time) => Number.isFinite(time));
    if (kickoffs.length === 0) continue;
    const { error } = await admin
      .from("gameweeks")
      .update({ deadline_at: deadlineFromKickoff(new Date(Math.min(...kickoffs))).toISOString() })
      .eq("id", week.id)
      .eq("status", "scheduled");
    if (error) throw new Error(error.message);
    deadlines += 1;
  }
  return deadlines;
}

async function serieARunningSeason(admin: ReturnType<typeof createAdminSupabase>) {
  const { data: competition, error } = await admin
    .from("competitions")
    .select("id")
    .eq("code", "serie_a")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!competition) throw httpError("Manca la competizione serie_a.", 409);
  const { data, error: seasonError } = await admin
    .from("seasons")
    .select("id")
    .eq("competition_id", competition.id)
    .in("status", ["running", "open"])
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seasonError) throw new Error(seasonError.message);
  if (!data) throw httpError("Nessuna stagione Serie A aperta.", 404);
  return getCurrentSeason(admin, data.id as string);
}

export async function refreshSerieAKickoffs(options?: { force?: boolean; seasonId?: string }) {
  const admin = createAdminSupabase();
  const season = options?.seasonId
    ? await getCurrentSeason(admin, options.seasonId)
    : await serieARunningSeason(admin);
  if (season.competitionCode !== "serie_a") {
    throw httpError("L'aggiornamento orari Sky vale solo per la Serie A.", 409);
  }
  const previous = await lastRefreshAt(admin, season.id);
  if (!options?.force && previous.at !== null && Date.now() - previous.at < WEEK_MS) {
    return {
      seasonCode: season.code,
      skipped: true,
      reason: "Orari già aggiornati negli ultimi 7 giorni.",
      updated: 0,
      kept: 0,
      results: 0,
      goalsColumn: true,
      deadlines: 0,
      rounds: 0,
      fixtures: 0,
      lockColumn: true,
      logged: previous.logged,
    };
  }
  if (!options?.force && !previous.logged) {
    return {
      seasonCode: season.code,
      skipped: true,
      reason: "Aggiornamento settimanale in attesa di calendar_setup.sql. Dal laboratorio puoi lanciarlo a mano.",
      updated: 0,
      kept: 0,
      results: 0,
      goalsColumn: true,
      deadlines: 0,
      rounds: 0,
      fixtures: 0,
      lockColumn: true,
      logged: false,
    };
  }

  const rounds = await fetchSkyCalendar();
  const stored = await loadStoredMatches(admin, season.id);
  const byKey = new Map(stored.matches.map((match) => [`${match.gameweekNumber}:${match.home}:${match.away}`, match]));
  let updated = 0;
  let kept = 0;
  let results = 0;
  let goalsColumn = true;

  for (const round of rounds) {
    for (const fixture of round.fixtures) {
      if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
      const match = byKey.get(`${round.number}:${fixture.home}:${fixture.away}`);
      if (!match) continue;
      const patch = { status: "finished" as const, home_goals: fixture.homeGoals, away_goals: fixture.awayGoals };
      let update = await admin.from("real_matches").update(patch).eq("id", match.id);
      if (update.error && /home_goals|away_goals/i.test(update.error.message)) {
        goalsColumn = false;
        update = await admin.from("real_matches").update({ status: "finished" }).eq("id", match.id);
      }
      if (update.error) throw new Error(schemaHint(update.error.message));
      match.status = "finished";
      results += 1;
    }
  }

  for (const round of rounds) {
    const timed = round.fixtures.filter((fixture) => fixture.timeKnown && fixture.kickoff);
    if (timed.length === 0) continue;
    const incoming = timed.map((fixture) => new Date(fixture.kickoff).getTime());
    const incomingUniform = new Set(incoming).size <= 1;
    const storedTimes = new Set(
      timed.flatMap((fixture) => {
        const match = byKey.get(`${round.number}:${fixture.home}:${fixture.away}`);
        return match ? [new Date(match.kickoffAt).getTime()] : [];
      }),
    );
    if (incomingUniform && storedTimes.size > 1) {
      kept += timed.length;
      continue;
    }
    for (const fixture of timed) {
      const match = byKey.get(`${round.number}:${fixture.home}:${fixture.away}`);
      if (!match || match.status !== "scheduled") continue;
      if (match.kickoffLocked) {
        kept += 1;
        continue;
      }
      if (new Date(match.kickoffAt).getTime() === new Date(fixture.kickoff).getTime()) continue;
      const { error } = await admin.from("real_matches").update({ kickoff_at: fixture.kickoff }).eq("id", match.id).eq("status", "scheduled");
      if (error) throw new Error(schemaHint(error.message));
      match.kickoffAt = fixture.kickoff;
      updated += 1;
    }
  }

  const deadlines = await refreshDeadlines(admin, stored.weeks, stored.matches);
  const logged = await rememberRefresh(admin, season.id, {
    rounds: rounds.length,
    fixtures: rounds.reduce((sum, round) => sum + round.fixtures.length, 0),
    updated,
  });
  return {
    seasonCode: season.code,
    skipped: false,
    reason: null,
    updated,
    kept,
    results,
    goalsColumn,
    deadlines,
    rounds: rounds.length,
    fixtures: rounds.reduce((sum, round) => sum + round.fixtures.length, 0),
    lockColumn: stored.lockColumn,
    logged,
  };
}

export async function refreshKickoffsForAdmin(userId: string) {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  if (season.competitionCode !== "serie_a") {
    throw httpError("L'aggiornamento orari Sky vale solo per la Serie A. Seleziona quella competizione.", 409);
  }
  await assertSeasonOwner(admin, userId, season.id);
  return refreshSerieAKickoffs({ force: true, seasonId: season.id });
}

export async function setGameweekStart(userId: string, input: { gameweekId: string; kickoffLocal: string }) {
  const kickoff = romeLocalToIso(input.kickoffLocal);
  if (!kickoff) throw httpError("Indica data e ora di inizio giornata.", 400);
  const admin = createAdminSupabase();
  const { data: gameweek, error } = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .eq("id", input.gameweekId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!gameweek) throw httpError("Giornata non trovata.", 404);
  if (gameweek.status === "final") throw httpError(`La giornata ${gameweek.number} è final e non si sposta.`, 409);
  await assertSeasonOwner(admin, userId, gameweek.season_id as string);

  const { error: updateError } = await admin.from("gameweeks").update({ deadline_at: kickoff }).eq("id", gameweek.id);
  if (updateError) throw new Error(schemaHint(updateError.message));

  const note = "Inizio giornata impostato a mano";
  const override = await admin.from("gameweek_overrides").upsert({
    gameweek_id: gameweek.id,
    deadline_at: kickoff,
    note,
  }, { onConflict: "gameweek_id" });
  const overrideReady = !override.error;
  if (override.error && !/gameweek_overrides|schema cache|could not find/i.test(override.error.message)) {
    throw new Error(override.error.message);
  }
  return {
    gameweekNumber: gameweek.number as number,
    deadlineAt: kickoff,
    protectedFromRefresh: overrideReady,
  };
}

export async function setMatchKickoff(userId: string, input: { matchId: string; kickoffLocal: string }) {
  const kickoff = romeLocalToIso(input.kickoffLocal);
  if (!kickoff) throw httpError("Indica data e ora della partita.", 400);
  const admin = createAdminSupabase();
  const listed = await admin
    .from("real_matches")
    .select("id, status, gameweek_id")
    .eq("id", input.matchId)
    .maybeSingle();
  if (listed.error) throw new Error(schemaHint(listed.error.message));
  if (!listed.data) throw httpError("Partita non trovata.", 404);
  if (listed.data.status !== "scheduled") {
    throw httpError("La partita è già iniziata: l'orario non si sposta.", 409);
  }
  const { data: gameweek, error } = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .eq("id", listed.data.gameweek_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!gameweek) throw httpError("Giornata non trovata.", 404);
  if (gameweek.status === "final") throw httpError(`La giornata ${gameweek.number} è final e non si sposta.`, 409);
  await assertSeasonOwner(admin, userId, gameweek.season_id as string);

  let lockStored = true;
  let update = await admin
    .from("real_matches")
    .update({ kickoff_at: kickoff, kickoff_locked: true })
    .eq("id", input.matchId)
    .eq("status", "scheduled");
  if (update.error && /kickoff_locked/i.test(update.error.message)) {
    lockStored = false;
    update = await admin.from("real_matches").update({ kickoff_at: kickoff }).eq("id", input.matchId).eq("status", "scheduled");
  }
  if (update.error) throw new Error(schemaHint(update.error.message));

  const stored = await loadStoredMatches(admin, gameweek.season_id as string);
  const match = stored.matches.find((item) => item.id === input.matchId);
  if (match) match.kickoffAt = kickoff;
  const deadlines = await refreshDeadlines(
    admin,
    stored.weeks,
    stored.matches,
    new Set([gameweek.id as string]),
  );
  return {
    gameweekNumber: gameweek.number as number,
    kickoffAt: kickoff,
    lockStored,
    deadlineMoved: deadlines > 0,
  };
}
