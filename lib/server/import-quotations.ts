import { randomUUID } from "node:crypto";
import { listoneProviders, resolveListoneAdapter, votesProviders } from "@/lib/adapters";
import type { AdapterSource, NormalizedPlayer } from "@/lib/adapters";
import { getCurrentSeason } from "@/lib/server/catalog";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function clubSlug(name: string) {
  const stripped = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|ac|as|us|ssc|bc|calcio)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return stripped;
}

type ClubRecord = { id: string; code: string };

async function assertSeasonAdmin(userId: string, seasonId: string) {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("private_leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("season_id", seasonId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) throw httpError("Solo il proprietario di una lega di questa stagione può importare.", 403);
  return admin;
}

async function currentGameweekNumber(admin: ReturnType<typeof createAdminSupabase>, seasonId: string) {
  const { data, error } = await admin
    .from("gameweeks")
    .select("number, status")
    .eq("season_id", seasonId)
    .order("number", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const current = rows.find((row) => row.status !== "final");
  return (current?.number as number | undefined) ?? (rows[rows.length - 1]?.number as number | undefined) ?? 1;
}

async function loadClubs(admin: ReturnType<typeof createAdminSupabase>, competitionId: string) {
  const { data: clubs, error } = await admin
    .from("clubs")
    .select("id, code")
    .eq("competition_id", competitionId);
  if (error) throw new Error(error.message);
  const records = (clubs ?? []) as ClubRecord[];
  const ids = records.map((club) => club.id);
  const names = ids.length
    ? await admin.from("club_translations").select("club_id, name, short_name").in("club_id", ids)
    : { data: [], error: null };
  if (names.error) throw new Error(names.error.message);

  const bySlug = new Map<string, ClubRecord>();
  for (const club of records) bySlug.set(clubSlug(club.code), club);
  for (const row of names.data ?? []) {
    const club = records.find((item) => item.id === row.club_id);
    if (!club) continue;
    bySlug.set(clubSlug(String(row.name)), club);
    bySlug.set(clubSlug(String(row.short_name)), club);
  }
  return { records, bySlug };
}

async function ensureClub(
  admin: ReturnType<typeof createAdminSupabase>,
  competitionId: string,
  seasonId: string,
  cache: Map<string, ClubRecord>,
  clubName: string,
) {
  const slug = clubSlug(clubName);
  const found = cache.get(slug);
  if (found) {
    const { error } = await admin.from("season_clubs").upsert(
      { season_id: seasonId, club_id: found.id },
      { onConflict: "season_id,club_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return { club: found, created: false };
  }

  const id = randomUUID();
  const code = slug.slice(0, 32) || `club-${id.slice(0, 8)}`;
  const { error } = await admin.from("clubs").insert({ id, competition_id: competitionId, code });
  if (error) throw new Error(error.message);
  const { error: nameError } = await admin.from("club_translations").insert({
    club_id: id,
    locale: "it",
    name: clubName.trim(),
    short_name: clubName.trim().slice(0, 12),
  });
  if (nameError) throw new Error(nameError.message);
  const { error: seasonError } = await admin.from("season_clubs").insert({ season_id: seasonId, club_id: id });
  if (seasonError) throw new Error(seasonError.message);
  const club = { id, code };
  cache.set(slug, club);
  cache.set(code, club);
  return { club, created: true };
}

function competitionColumnMissing(message: string) {
  return /competition_id/i.test(message);
}

async function upsertPlayer(
  admin: ReturnType<typeof createAdminSupabase>,
  competitionId: string,
  player: NormalizedPlayer,
) {
  const existing = await admin
    .from("players")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("external_ref", player.externalRef)
    .maybeSingle();
  if (existing.error) {
    if (competitionColumnMissing(existing.error.message)) {
      throw httpError("Esegui multi_competition.sql: il codice calciatore deve essere unico dentro la competizione.", 409);
    }
    throw new Error(existing.error.message);
  }
  if (existing.data?.id) {
    const { error: updateError } = await admin
      .from("players")
      .update({ full_name: player.name })
      .eq("id", existing.data.id);
    if (updateError) throw new Error(updateError.message);
    return existing.data.id as string;
  }
  const id = randomUUID();
  const { error: insertError } = await admin.from("players").insert({
    id,
    competition_id: competitionId,
    external_ref: player.externalRef,
    full_name: player.name,
  });
  if (insertError) {
    if (competitionColumnMissing(insertError.message)) {
      throw httpError("Esegui multi_competition.sql: il codice calciatore deve essere unico dentro la competizione.", 409);
    }
    throw new Error(insertError.message);
  }
  return id;
}

async function keepRegistration(
  admin: ReturnType<typeof createAdminSupabase>,
  seasonId: string,
  playerId: string,
  clubId: string,
  role: PlayerRole,
  currentGameweek: number,
) {
  const extended = await admin
    .from("player_registrations")
    .select("id, club_id, role, role_locked, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId)
    .eq("player_id", playerId)
    .order("effective_from_gameweek", { ascending: true });
  const plain = extended.error && /role_locked/i.test(extended.error.message)
    ? await admin
      .from("player_registrations")
      .select("id, club_id, role, effective_from_gameweek, effective_to_gameweek")
      .eq("season_id", seasonId)
      .eq("player_id", playerId)
      .order("effective_from_gameweek", { ascending: true })
    : extended;
  if (plain.error) throw new Error(plain.error.message);
  const lockReady = !extended.error;

  const open = (plain.data ?? []).find((row) => {
    const until = row.effective_to_gameweek as number | null;
    const from = row.effective_from_gameweek as number;
    return from <= currentGameweek && (until === null || until >= currentGameweek);
  }) as { id: string; club_id: string; role: string; role_locked?: boolean } | undefined;
  const locked = Boolean(open?.role_locked);
  const nextRole = (locked ? open?.role ?? role : role) as PlayerRole;

  if (open && open.club_id === clubId) {
    if (!locked && open.role !== role) {
      const { error: roleError } = await admin.from("player_registrations").update({ role }).eq("id", open.id);
      if (roleError) throw new Error(roleError.message);
    }
    return "updated" as const;
  }

  const previous = Math.max(0, currentGameweek - 1);
  if (open) {
    const { error: closeError } = await admin
      .from("player_registrations")
      .update({ effective_to_gameweek: previous })
      .eq("id", open.id);
    if (closeError) throw new Error(closeError.message);
  }

  const { error: insertError } = await admin.from("player_registrations").insert({
    id: randomUUID(),
    season_id: seasonId,
    player_id: playerId,
    club_id: clubId,
    role: nextRole,
    ...(lockReady ? { role_locked: locked } : {}),
    effective_from_gameweek: currentGameweek,
    effective_to_gameweek: null,
  });
  if (insertError) throw new Error(insertError.message);
  return open ? "moved" as const : "created" as const;
}

async function releasePlayer(
  admin: ReturnType<typeof createAdminSupabase>,
  seasonId: string,
  playerId: string,
  currentGameweek: number,
) {
  const previous = Math.max(0, currentGameweek - 1);
  const { data, error } = await admin
    .from("player_registrations")
    .select("id, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId)
    .eq("player_id", playerId);
  if (error) throw new Error(error.message);
  const open = (data ?? []).filter((row) => row.effective_to_gameweek === null);
  if (open.length === 0) return false;
  for (const row of open) {
    const { error: closeError } = await admin
      .from("player_registrations")
      .update({ effective_to_gameweek: previous })
      .eq("id", row.id);
    if (closeError) throw new Error(closeError.message);
  }
  return true;
}

export async function importQuotations(
  userId: string,
  input: { competitionId: string; seasonId: string; provider?: string; source: AdapterSource },
) {
  const admin = await assertSeasonAdmin(userId, input.seasonId);
  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("id, competition_id, code")
    .eq("id", input.seasonId)
    .maybeSingle();
  if (seasonError) throw new Error(seasonError.message);
  if (!season) throw httpError("Stagione non trovata.", 404);
  if (season.competition_id !== input.competitionId) {
    throw httpError("La stagione non appartiene alla competizione scelta.", 400);
  }

  const adapter = resolveListoneAdapter(input.provider);
  const book = await adapter.parse(input.source);

  const currentGameweek = await currentGameweekNumber(admin, input.seasonId);
  const clubs = await loadClubs(admin, input.competitionId);
  let clubsCreated = 0;
  let created = 0;
  let updated = 0;
  let moved = 0;
  let released = 0;

  for (const player of book.active) {
    const club = await ensureClub(admin, input.competitionId, input.seasonId, clubs.bySlug, player.clubName);
    if (club.created) clubsCreated += 1;
    const playerId = await upsertPlayer(admin, input.competitionId, player);
    const result = await keepRegistration(
      admin,
      input.seasonId,
      playerId,
      club.club.id,
      player.role,
      currentGameweek,
    );
    if (result === "created") created += 1;
    if (result === "updated") updated += 1;
    if (result === "moved") moved += 1;
  }

  for (const player of book.released) {
    const { data, error } = await admin
      .from("players")
      .select("id")
      .eq("competition_id", input.competitionId)
      .eq("external_ref", player.externalRef)
      .maybeSingle();
    if (error) {
      if (competitionColumnMissing(error.message)) {
        throw httpError("Esegui multi_competition.sql: il codice calciatore deve essere unico dentro la competizione.", 409);
      }
      throw new Error(error.message);
    }
    const playerId = data?.id ? data.id as string : await upsertPlayer(admin, input.competitionId, player);
    const closed = await releasePlayer(admin, input.seasonId, playerId, currentGameweek);
    if (closed) released += 1;
  }

  return {
    provider: adapter.id,
    seasonCode: season.code as string,
    currentGameweek,
    active: book.active.length,
    created,
    updated,
    moved,
    released,
    clubsCreated,
  };
}

export async function loadImportOptions(userId: string) {
  const admin = createAdminSupabase();
  const { data: leagues, error: leagueError } = await admin
    .from("private_leagues")
    .select("season_id")
    .eq("owner_user_id", userId);
  if (leagueError) throw new Error(leagueError.message);
  const seasonIds = [...new Set((leagues ?? []).map((row) => row.season_id as string))];
  const providers = {
    listoneProviders: listoneProviders(),
    voteProviders: votesProviders(),
  };
  let activeSeasonId: string | null = null;
  try {
    activeSeasonId = (await getCurrentSeason(admin)).id;
  } catch {
    activeSeasonId = null;
  }
  if (seasonIds.length === 0) {
    return { seasons: [], competitions: [], gameweeks: [], activeSeasonId, ...providers };
  }

  const { data: seasons, error: seasonError } = await admin
    .from("seasons")
    .select("id, code, competition_id")
    .in("id", seasonIds)
    .order("code");
  if (seasonError) throw new Error(seasonError.message);
  const competitionIds = [...new Set((seasons ?? []).map((row) => row.competition_id as string))];
  const { data: competitions, error: competitionError } = competitionIds.length
    ? await admin.from("competitions").select("id, code").in("id", competitionIds)
    : { data: [], error: null };
  if (competitionError) throw new Error(competitionError.message);

  const { data: gameweeks, error: gameweekError } = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .in("season_id", seasonIds)
    .order("number");
  if (gameweekError) throw new Error(gameweekError.message);

  return {
    competitions: (competitions ?? []).map((row) => ({ id: row.id as string, code: row.code as string })),
    seasons: (seasons ?? []).map((row) => ({
      id: row.id as string,
      code: row.code as string,
      competitionId: row.competition_id as string,
    })),
    gameweeks: (gameweeks ?? []).map((row) => ({
      id: row.id as string,
      number: row.number as number,
      status: row.status as string,
      seasonId: row.season_id as string,
    })),
    activeSeasonId,
    ...providers,
  };
}
