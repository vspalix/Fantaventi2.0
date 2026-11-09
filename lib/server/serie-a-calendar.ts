import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getCurrentSeason } from "@/lib/server/catalog";
import { processGameweekLifecycle } from "@/lib/server/gameweek-lifecycle";
import { schemaHint } from "@/lib/server/live-score";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type CalendarFixture = {
  home: string;
  away: string;
  kickoff: string;
  timeKnown?: boolean;
  homeGoals?: number | null;
  awayGoals?: number | null;
};

export type CalendarRound = {
  number: number;
  fixtures: CalendarFixture[];
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function deadlineFromKickoff(kickoff: Date) {
  return new Date(kickoff.getTime() - 60 * 1000);
}

export function bundledSerieACalendar() {
  const file = path.join(process.cwd(), "data", "serie-a-2026-27.json");
  return parseCalendarPayload(JSON.parse(readFileSync(file, "utf8")));
}

export function parseCalendarPayload(value: unknown): CalendarRound[] {
  const record = value && typeof value === "object" ? value as { rounds?: unknown } : null;
  const rounds = Array.isArray(value) ? value : record?.rounds;
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw httpError("Il calendario non contiene giornate.", 400);
  }
  return rounds.map((round, index) => {
    const item = round as { number?: unknown; fixtures?: unknown };
    const number = Number(item.number);
    if (!Number.isInteger(number) || number < 1) {
      throw httpError(`La giornata in posizione ${index + 1} non ha un numero valido.`, 400);
    }
    if (!Array.isArray(item.fixtures) || item.fixtures.length === 0) {
      throw httpError(`La giornata ${number} non ha partite.`, 400);
    }
    const fixtures = item.fixtures.map((fixture) => {
      const match = fixture as { home?: unknown; away?: unknown; kickoff?: unknown; timeKnown?: unknown };
      const home = String(match.home ?? "").trim().toLowerCase();
      const away = String(match.away ?? "").trim().toLowerCase();
      const kickoff = String(match.kickoff ?? "");
      if (!home || !away || home === away || Number.isNaN(new Date(kickoff).getTime())) {
        throw httpError(`Partita non valida in giornata ${number}.`, 400);
      }
      return { home, away, kickoff: new Date(kickoff).toISOString(), timeKnown: match.timeKnown === true };
    });
    return { number, fixtures };
  });
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
    throw httpError("Solo il proprietario di una lega di questa stagione può gestire il calendario.", 403);
  }
}

export async function importSerieACalendar(
  userId: string,
  rounds: CalendarRound[],
  source: "bundled" | "payload" = "payload",
) {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  await assertSeasonOwner(admin, userId, season.id);
  if (source === "bundled" && season.competitionCode !== "serie_a") {
    throw httpError("Il calendario incluso è della Serie A. Seleziona quella competizione, oppure invia i turni della competizione attiva.", 409);
  }

  const codes = [...new Set(rounds.flatMap((round) => round.fixtures.flatMap((fixture) => [fixture.home, fixture.away])))];
  const { data: clubs, error: clubError } = await admin
    .from("clubs")
    .select("id, code")
    .eq("competition_id", season.competitionId)
    .in("code", codes);
  if (clubError) throw new Error(clubError.message);
  const clubIds = new Map((clubs ?? []).map((club) => [club.code as string, club.id as string]));
  const missingClubs = codes.filter((code) => !clubIds.has(code));
  if (missingClubs.length) {
    throw httpError(`Club assenti nel listone squadre: ${missingClubs.join(", ")}.`, 409);
  }

  const numbers = [...new Set(rounds.map((round) => round.number))];
  const { data: weeks, error: weekError } = await admin
    .from("gameweeks")
    .select("id, number, status")
    .eq("season_id", season.id)
    .in("number", numbers);
  if (weekError) throw new Error(weekError.message);
  const gameweeks = new Map((weeks ?? []).map((week) => [week.number as number, week]));
  const missingWeeks = numbers.filter((number) => !gameweeks.has(number));
  if (missingWeeks.length) {
    throw httpError(`Mancano le giornate ${missingWeeks.join(", ")}. Genera i turni di questa stagione con generate_season_calendar.`, 409);
  }

  const weekIds = [...gameweeks.values()].map((week) => week.id as string);
  const { data: current, error: currentError } = await admin
    .from("real_matches")
    .select("id, gameweek_id, home_club_id, away_club_id")
    .in("gameweek_id", weekIds);
  if (currentError) throw new Error(schemaHint(currentError.message));
  const existing = new Map((current ?? []).map((row) => [
    `${row.gameweek_id}:${row.home_club_id}:${row.away_club_id}`,
    row.id as string,
  ]));

  const rows = rounds.flatMap((round) => {
    const gameweek = gameweeks.get(round.number);
    if (!gameweek) return [];
    return round.fixtures.map((fixture) => {
      const homeId = clubIds.get(fixture.home) as string;
      const awayId = clubIds.get(fixture.away) as string;
      const key = `${gameweek.id}:${homeId}:${awayId}`;
      return {
        id: existing.get(key) ?? randomUUID(),
        gameweek_id: gameweek.id as string,
        home_club_id: homeId,
        away_club_id: awayId,
        kickoff_at: fixture.kickoff,
      };
    });
  });

  let written = 0;
  for (let index = 0; index < rows.length; index += 80) {
    const { error } = await admin
      .from("real_matches")
      .upsert(rows.slice(index, index + 80), { onConflict: "gameweek_id,home_club_id,away_club_id" });
    if (error) throw new Error(schemaHint(error.message));
    written += Math.min(80, rows.length - index);
  }

  const overrides = await admin.from("gameweek_overrides").select("gameweek_id, deadline_at").in("gameweek_id", weekIds);
  const manual = new Set<string>();
  if (!overrides.error) {
    for (const row of overrides.data ?? []) {
      if (row.deadline_at) manual.add(row.gameweek_id as string);
    }
  } else if (!/gameweek_overrides|schema cache|could not find/i.test(overrides.error.message)) {
    throw new Error(overrides.error.message);
  }

  let deadlines = 0;
  for (const round of rounds) {
    const gameweek = gameweeks.get(round.number);
    if (!gameweek || gameweek.status !== "scheduled" || manual.has(gameweek.id as string)) continue;
    const first = round.fixtures.reduce((earliest, fixture) => {
      const time = new Date(fixture.kickoff).getTime();
      return time < earliest ? time : earliest;
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(first)) continue;
    const { error } = await admin
      .from("gameweeks")
      .update({ deadline_at: deadlineFromKickoff(new Date(first)).toISOString() })
      .eq("id", gameweek.id)
      .eq("status", "scheduled");
    if (error) throw new Error(error.message);
    deadlines += 1;
  }

  const lifecycle = await processGameweekLifecycle();
  const timed = rounds.reduce((sum, round) => sum + round.fixtures.filter((fixture) => fixture.timeKnown).length, 0);
  return {
    seasonCode: season.code as string,
    rounds: rounds.length,
    fixtures: written,
    deadlines,
    kickoffsWithPublishedTime: timed,
    lifecycle,
  };
}

export async function listGameweekMatches(userId: string, gameweekId: string) {
  const admin = createAdminSupabase();
  const { data: gameweek, error: gameweekError } = await admin
    .from("gameweeks")
    .select("id, number, status, season_id, deadline_at")
    .eq("id", gameweekId)
    .maybeSingle();
  if (gameweekError) throw new Error(gameweekError.message);
  if (!gameweek) throw httpError("Giornata non trovata.", 404);
  await assertSeasonOwner(admin, userId, gameweek.season_id as string);

  const withScores = await admin
    .from("real_matches")
    .select("id, kickoff_at, status, home_club_id, away_club_id, kickoff_locked, home_goals, away_goals")
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at");
  const withLock = withScores.error && /home_goals|away_goals/i.test(withScores.error.message)
    ? await admin
      .from("real_matches")
      .select("id, kickoff_at, status, home_club_id, away_club_id, kickoff_locked")
      .eq("gameweek_id", gameweekId)
      .order("kickoff_at")
    : withScores;
  const listed = withLock.error && /kickoff_locked/i.test(withLock.error.message)
    ? await admin
      .from("real_matches")
      .select("id, kickoff_at, status, home_club_id, away_club_id")
      .eq("gameweek_id", gameweekId)
      .order("kickoff_at")
    : withLock;
  const { data, error } = listed;
  if (error) {
    if (/real_matches|schema cache|could not find/i.test(error.message)) {
      return {
        gameweekNumber: gameweek.number as number,
        gameweekStatus: gameweek.status as string,
        deadlineAt: gameweek.deadline_at as string,
        matches: [],
      };
    }
    throw new Error(error.message);
  }
  const clubIds = [...new Set((data ?? []).flatMap((row) => [row.home_club_id as string, row.away_club_id as string]))];
  const names = new Map<string, string>();
  if (clubIds.length) {
    const clubs = await admin.from("clubs").select("id, code").in("id", clubIds);
    if (clubs.error) throw new Error(clubs.error.message);
    for (const club of clubs.data ?? []) names.set(club.id as string, (club.code as string).toUpperCase());
    const shorts = await admin.from("club_translations").select("club_id, short_name").eq("locale", "it").in("club_id", clubIds);
    if (!shorts.error) {
      for (const row of shorts.data ?? []) names.set(row.club_id as string, row.short_name as string);
    }
  }
  return {
    gameweekNumber: gameweek.number as number,
    gameweekStatus: gameweek.status as string,
    deadlineAt: gameweek.deadline_at as string,
    matches: (data ?? []).map((row) => ({
      id: row.id as string,
      home: names.get(row.home_club_id as string) ?? "casa",
      away: names.get(row.away_club_id as string) ?? "trasferta",
      kickoffAt: row.kickoff_at as string,
      status: row.status as string,
      kickoffLocked: Boolean((row as { kickoff_locked?: boolean }).kickoff_locked),
      homeGoals: goalOf((row as { home_goals?: number | null }).home_goals),
      awayGoals: goalOf((row as { away_goals?: number | null }).away_goals),
    })),
  };
}

function goalOf(value: number | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function goalPair(homeGoals: number | null | undefined, awayGoals: number | null | undefined) {
  if (homeGoals === null || homeGoals === undefined) {
    if (awayGoals === null || awayGoals === undefined) return { home_goals: null, away_goals: null };
  }
  const home = Number(homeGoals);
  const away = Number(awayGoals);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    throw httpError("Il risultato è fatto da due numeri interi, casa e trasferta.", 400);
  }
  return { home_goals: home, away_goals: away };
}

export async function setMatchResult(
  userId: string,
  input: {
    matchId?: string;
    gameweekId?: string;
    status: "scheduled" | "finished";
    homeGoals?: number | null;
    awayGoals?: number | null;
  },
) {
  if (input.status !== "scheduled" && input.status !== "finished") {
    throw httpError("Lo stato della partita è in programma oppure finita.", 400);
  }
  const admin = createAdminSupabase();
  const goals = input.status === "scheduled"
    ? { home_goals: null, away_goals: null }
    : goalPair(input.homeGoals, input.awayGoals);

  if (input.matchId) {
    const listed = await admin.from("real_matches").select("id, gameweek_id").eq("id", input.matchId).maybeSingle();
    if (listed.error) throw new Error(schemaHint(listed.error.message));
    if (!listed.data) throw httpError("Partita non trovata.", 404);
    const gameweek = await admin.from("gameweeks").select("season_id").eq("id", listed.data.gameweek_id).maybeSingle();
    if (gameweek.error) throw new Error(gameweek.error.message);
    if (!gameweek.data) throw httpError("Giornata non trovata.", 404);
    await assertMatchOwner(admin, userId, gameweek.data.season_id as string);
    await writeMatchPatch(admin, input.matchId, input.status, goals);
    return { updated: 1 };
  }

  if (!input.gameweekId) throw httpError("Indica la partita o la giornata.", 400);
  const gameweek = await admin.from("gameweeks").select("id, season_id").eq("id", input.gameweekId).maybeSingle();
  if (gameweek.error) throw new Error(gameweek.error.message);
  if (!gameweek.data) throw httpError("Giornata non trovata.", 404);
  await assertMatchOwner(admin, userId, gameweek.data.season_id as string);
  const patch = input.status === "scheduled"
    ? { status: input.status, home_goals: null, away_goals: null }
    : { status: input.status };
  let update = await admin.from("real_matches").update(patch).eq("gameweek_id", input.gameweekId).select("id");
  if (update.error && /home_goals|away_goals/i.test(update.error.message)) {
    update = await admin.from("real_matches").update({ status: input.status }).eq("gameweek_id", input.gameweekId).select("id");
  }
  if (update.error) throw new Error(schemaHint(update.error.message));
  return { updated: update.data?.length ?? 0 };
}

async function assertMatchOwner(admin: ReturnType<typeof createAdminSupabase>, userId: string, seasonId: string) {
  const { data, error } = await admin
    .from("private_leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("season_id", seasonId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) throw httpError("Solo chi ha creato una lega di questa stagione può segnare le partite.", 403);
}

async function writeMatchPatch(
  admin: ReturnType<typeof createAdminSupabase>,
  matchId: string,
  status: "scheduled" | "finished",
  goals: { home_goals: number | null; away_goals: number | null },
) {
  let update = await admin.from("real_matches").update({ status, ...goals }).eq("id", matchId);
  if (update.error && /home_goals|away_goals/i.test(update.error.message)) {
    update = await admin.from("real_matches").update({ status }).eq("id", matchId);
  }
  if (update.error) throw new Error(schemaHint(update.error.message));
}
