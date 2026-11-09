import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

const ROLES = new Set<PlayerRole>(["GK", "DEF", "MID", "FWD"]);

export type ListoneRow = {
  id: string;
  name: string;
  role: PlayerRole;
  roleLabel: "P" | "D" | "C" | "A";
  roleLocked: boolean;
  club: string;
  status: "active" | "released";
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function roleLabel(role: PlayerRole): ListoneRow["roleLabel"] {
  if (role === "GK") return "P";
  if (role === "DEF") return "D";
  if (role === "MID") return "C";
  return "A";
}

type ClubEmbed = {
  code: string;
  club_translations: { locale: string; name: string }[] | null;
};

function oneClub(club: ClubEmbed | ClubEmbed[] | null): ClubEmbed | null {
  if (Array.isArray(club)) return club[0] ?? null;
  return club;
}

function clubName(club: ClubEmbed | null) {
  const translations = club?.club_translations ?? [];
  const italian = translations.find((item) => item.locale === "it") ?? translations[0];
  return italian?.name ?? club?.code ?? "Squadra";
}

type RegistrationRow = {
  id: string;
  player_id: string;
  role: string;
  role_locked?: boolean;
  effective_from_gameweek: number;
  effective_to_gameweek: number | null;
  players: { full_name: string } | { full_name: string }[] | null;
  clubs: ClubEmbed | ClubEmbed[] | null;
};

function playerName(players: RegistrationRow["players"]) {
  if (Array.isArray(players)) return players[0]?.full_name ?? "Calciatore";
  return players?.full_name ?? "Calciatore";
}

export async function loadListone(userId: string, competitionCode: string, seasonCode: string) {
  const competition = competitionCode.trim();
  const season = seasonCode.trim();
  if (!competition || !season) throw httpError("Servono competizione e stagione.", 400);

  const admin = createAdminSupabase();
  const { data: competitionRow, error: competitionError } = await admin
    .from("competitions")
    .select("id")
    .eq("code", competition)
    .maybeSingle();
  if (competitionError) throw new Error(competitionError.message);
  if (!competitionRow) throw httpError("Competizione non trovata.", 404);

  const { data: seasonRow, error: seasonError } = await admin
    .from("seasons")
    .select("id, code")
    .eq("competition_id", competitionRow.id)
    .eq("code", season)
    .maybeSingle();
  if (seasonError) throw new Error(seasonError.message);
  if (!seasonRow) throw httpError("Stagione non trovata.", 404);

  const { data: owned, error: ownedError } = await admin
    .from("private_leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("season_id", seasonRow.id)
    .limit(1);
  if (ownedError) throw new Error(ownedError.message);
  if (!owned?.length) throw httpError("Solo il proprietario di una lega di questa stagione può consultare il listone.", 403);

  const extended = await admin
    .from("player_registrations")
    .select("id, player_id, role, role_locked, effective_from_gameweek, effective_to_gameweek, players(full_name), clubs(code, club_translations(locale, name))")
    .eq("season_id", seasonRow.id);
  const plain = extended.error && /role_locked/i.test(extended.error.message)
    ? await admin
      .from("player_registrations")
      .select("id, player_id, role, effective_from_gameweek, effective_to_gameweek, players(full_name), clubs(code, club_translations(locale, name))")
      .eq("season_id", seasonRow.id)
    : extended;
  if (plain.error) throw new Error(plain.error.message);
  const data = plain.data;
  const rows = (data ?? []) as unknown as RegistrationRow[];

  const chosen = new Map<string, RegistrationRow>();
  for (const row of rows) {
    const current = chosen.get(row.player_id);
    const open = row.effective_to_gameweek == null;
    if (!current) {
      chosen.set(row.player_id, row);
      continue;
    }
    const currentOpen = current.effective_to_gameweek == null;
    if (open && !currentOpen) chosen.set(row.player_id, row);
    else if (open === currentOpen && row.effective_from_gameweek > current.effective_from_gameweek) {
      chosen.set(row.player_id, row);
    }
  }

  const players: ListoneRow[] = [...chosen.values()].flatMap((row) => {
    if (!ROLES.has(row.role as PlayerRole)) return [];
    const role = row.role as PlayerRole;
    return [{
      id: row.id,
      name: playerName(row.players),
      role,
      roleLabel: roleLabel(role),
      roleLocked: Boolean(row.role_locked),
      club: clubName(oneClub(row.clubs)),
      status: row.effective_to_gameweek == null ? "active" as const : "released" as const,
    }];
  });
  players.sort((left, right) => left.name.localeCompare(right.name, "it"));

  const clubs = [...new Set(players.map((player) => player.club))].sort((left, right) => left.localeCompare(right, "it"));
  return {
    competition,
    season: seasonRow.code as string,
    summary: {
      active: players.filter((player) => player.status === "active").length,
      released: players.filter((player) => player.status === "released").length,
      total: players.length,
    },
    clubs,
    players,
  };
}

const LABEL_ROLE = { P: "GK", D: "DEF", C: "MID", A: "FWD" } as const;

export async function correctListoneRole(
  userId: string,
  registrationId: string,
  roleLabelValue: keyof typeof LABEL_ROLE,
) {
  if (!registrationId) throw httpError("Manca il calciatore.", 400);
  const role = LABEL_ROLE[roleLabelValue];
  if (!role) throw httpError("Ruolo non valido. Usa P, D, C o A.", 400);

  const admin = createAdminSupabase();
  const { data: registration, error } = await admin
    .from("player_registrations")
    .select("id, season_id, effective_to_gameweek")
    .eq("id", registrationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!registration) throw httpError("Calciatore non trovato nel listone.", 404);
  if (registration.effective_to_gameweek != null) throw httpError("Un ceduto non si corregge: rientra con un nuovo listone.", 409);

  const { data: owned, error: ownedError } = await admin
    .from("private_leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("season_id", registration.season_id)
    .limit(1);
  if (ownedError) throw new Error(ownedError.message);
  if (!owned?.length) throw httpError("Solo il proprietario di una lega di questa stagione può correggere un ruolo.", 403);

  const { error: updateError } = await admin
    .from("player_registrations")
    .update({ role, role_locked: true })
    .eq("id", registrationId);
  if (updateError && /role_locked/i.test(updateError.message)) {
    throw httpError("Per correggere il ruolo esegui role_correction.sql nell'editor SQL di Supabase.", 409);
  }
  if (updateError) throw new Error(updateError.message);
  return { id: registrationId, role, roleLabel: roleLabelValue, roleLocked: true };
}
