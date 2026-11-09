import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createAdminSupabase, hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { DEFAULT_RULES, type CatalogPlayer, type CatalogResponse, type ClubRef, type PlayerRole, type RosterRules } from "@/lib/types";

export const SEASON_COOKIE = "fv-season";

type RegistrationRow = {
  player_id: string;
  role: PlayerRole;
  club_id: string;
  players: { full_name: string } | { full_name: string }[] | null;
  clubs: {
    code: string;
    club_translations: { locale: string; name: string; short_name: string }[] | null;
  } | {
    code: string;
    club_translations: { locale: string; name: string; short_name: string }[] | null;
  }[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function parseRules(definition: unknown): RosterRules {
  const source = (definition ?? {}) as {
    squad_size?: number;
    goalkeepers?: { min?: number; max?: number };
    outfield_roles?: { min?: number; max?: number };
  };
  return {
    squadSize: source.squad_size ?? DEFAULT_RULES.squadSize,
    gkMin: source.goalkeepers?.min ?? DEFAULT_RULES.gkMin,
    gkMax: source.goalkeepers?.max ?? DEFAULT_RULES.gkMax,
    outfieldMin: source.outfield_roles?.min ?? DEFAULT_RULES.outfieldMin,
    outfieldMax: source.outfield_roles?.max ?? DEFAULT_RULES.outfieldMax,
  };
}

function italianName(
  translations: { locale: string; name: string; short_name: string }[] | null | undefined,
  fallback: string,
) {
  const italian = translations?.find((row) => row.locale === "it") ?? translations?.[0];
  return {
    name: italian?.name ?? fallback,
    shortName: italian?.short_name ?? fallback.slice(0, 3).toUpperCase(),
  };
}

export function assertServiceEnv() {
  if (!hasServiceSupabaseEnv()) {
    const error = new Error("Manca SUPABASE_SERVICE_ROLE_KEY nel server.");
    (error as Error & { status: number }).status = 500;
    throw error;
  }
}

type SeasonRow = {
  id: string;
  code: string;
  status: string;
  competition_id: string;
  rulesets: { definition: unknown } | { definition: unknown }[] | null;
  competitions: {
    code: string;
    competition_translations: { locale: string; name: string }[] | null;
  } | {
    code: string;
    competition_translations: { locale: string; name: string }[] | null;
  }[] | null;
};

export type CurrentSeason = {
  id: string;
  code: string;
  status: string;
  competitionId: string;
  competitionCode: string;
  competitionName: string;
  rules: RosterRules;
};

const SEASON_COLUMNS = "id, code, status, competition_id, competitions(code, competition_translations(locale, name)), rulesets(definition)";

function mapSeason(data: SeasonRow): CurrentSeason {
  const competition = one(data.competitions);
  const translations = competition?.competition_translations ?? [];
  const label = translations.find((row) => row.locale === "it") ?? translations[0];
  const ruleset = one(data.rulesets);
  return {
    id: data.id,
    code: data.code,
    status: data.status,
    competitionId: data.competition_id,
    competitionCode: competition?.code ?? "",
    competitionName: label?.name ?? competition?.code ?? "Competizione",
    rules: parseRules(ruleset?.definition),
  };
}

async function cookieSeasonId() {
  try {
    const jar = await cookies();
    const value = jar.get(SEASON_COOKIE)?.value?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

export async function listPlayableSeasons(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("seasons")
    .select(SEASON_COLUMNS)
    .in("status", ["running", "open"])
    .order("starts_on", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SeasonRow[]).map(mapSeason);
}

export async function getCurrentSeason(admin: SupabaseClient, seasonId?: string | null) {
  const requested = seasonId ?? await cookieSeasonId();
  if (requested) {
    const { data, error } = await admin
      .from("seasons")
      .select(SEASON_COLUMNS)
      .eq("id", requested)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      const season = mapSeason(data as SeasonRow);
      if (seasonId || season.status === "running" || season.status === "open") return season;
    } else if (seasonId) {
      const missing = new Error("Stagione non trovata.");
      (missing as Error & { status: number }).status = 404;
      throw missing;
    }
  }

  const seasons = await listPlayableSeasons(admin);
  const season = seasons[0];
  if (!season) {
    const missing = new Error("Nessuna stagione aperta. Esegui il seed.");
    (missing as Error & { status: number }).status = 404;
    throw missing;
  }
  return season;
}

export async function ensureProfile(admin: SupabaseClient, userId: string, email: string | undefined) {
  const displayName = email?.split("@")[0] || "Allenatore";
  const { error } = await admin.from("profiles").upsert(
    { id: userId, display_name: displayName, locale: "it" },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

export async function loadCatalog(seasonId?: string): Promise<CatalogResponse> {
  assertServiceEnv();
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin, seasonId);

  const { data: clubRows, error: clubError } = await admin
    .from("season_clubs")
    .select("club_id, clubs(code, club_translations(locale, name, short_name))")
    .eq("season_id", season.id);
  if (clubError) throw new Error(clubError.message);

  const clubs: ClubRef[] = (clubRows ?? []).map((row) => {
    const club = one(row.clubs as RegistrationRow["clubs"]);
    const label = italianName(club?.club_translations, club?.code ?? "Club");
    return {
      id: row.club_id as string,
      code: club?.code ?? "",
      name: label.name,
      shortName: label.shortName,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "it"));

  const { data: registrations, error } = await admin
    .from("player_registrations")
    .select("player_id, role, club_id, players(full_name), clubs(code, club_translations(locale, name, short_name))")
    .eq("season_id", season.id)
    .is("effective_to_gameweek", null);
  if (error) throw new Error(error.message);

  const players: CatalogPlayer[] = (registrations as RegistrationRow[] | null ?? []).map((row) => {
    const player = one(row.players);
    const club = one(row.clubs);
    const label = italianName(club?.club_translations, club?.code ?? "Club");
    return {
      id: row.player_id,
      fullName: player?.full_name ?? "Calciatore",
      role: row.role,
      clubId: row.club_id,
      clubCode: club?.code ?? "",
      clubName: label.name,
      clubShort: label.shortName,
    };
  }).sort((a, b) => a.fullName.localeCompare(b.fullName, "it"));

  return { seasonId: season.id, seasonCode: season.code, clubs, players, rules: season.rules };
}

export async function getFantasyTeam(admin: SupabaseClient, userId: string, seasonId: string) {
  const { data, error } = await admin
    .from("fantasy_teams")
    .select("id, name")
    .eq("user_id", userId)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; name: string } | null;
}

export async function ensureFantasyTeam(
  admin: SupabaseClient,
  userId: string,
  seasonId: string,
  teamName: string,
) {
  const existing = await getFantasyTeam(admin, userId, seasonId);
  if (existing) {
    if (teamName && teamName !== existing.name) {
      const { error } = await admin.from("fantasy_teams").update({ name: teamName }).eq("id", existing.id);
      if (error) throw new Error(error.message);
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  const { error } = await admin.from("fantasy_teams").insert({
    id,
    user_id: userId,
    season_id: seasonId,
    name: teamName,
  });
  if (error) throw new Error(error.message);
  return id;
}
