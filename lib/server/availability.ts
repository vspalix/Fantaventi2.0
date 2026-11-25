import type { AvailabilityStatus } from "@/lib/availability-providers";
import { providerFor } from "@/lib/availability-providers";
import { matchAvailability, type AvailabilityAlias, type KnownPlayer } from "@/lib/availability-providers/match";
import { getCurrentSeason } from "@/lib/server/catalog";
import { readSystemSettings } from "@/lib/server/system-settings";
import type { CatalogPlayer } from "@/lib/types";
import { createAdminSupabase } from "@/lib/supabase/admin";

const SETTINGS_KEY = "availability";

export type AvailabilitySettings = {
  provider: "api-football" | "external-json" | "manual";
  leagueId: number;
  season: number;
  jsonUrl: string;
  lastSyncAt: string | null;
  lastSyncNote: string | null;
  unmatched: { name: string; club: string; reason: string | null }[];
  aliases: AvailabilityAlias[];
};

const DEFAULTS: AvailabilitySettings = {
  provider: "api-football",
  leagueId: Number(process.env.AVAILABILITY_LEAGUE_ID) || 135,
  season: Number(process.env.AVAILABILITY_SEASON) || 2026,
  jsonUrl: "",
  lastSyncAt: null,
  lastSyncNote: null,
  unmatched: [],
  aliases: [],
};

function missing(message: string) {
  return /player_availability|app_settings|schema cache|could not find|does not exist/i.test(message);
}

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function asSettings(value: unknown): AvailabilitySettings {
  const row = (value ?? {}) as Partial<AvailabilitySettings>;
  const provider = row.provider === "external-json" || row.provider === "manual" ? row.provider : "api-football";
  return {
    provider,
    leagueId: Number.isFinite(Number(row.leagueId)) ? Number(row.leagueId) : 135,
    season: Number.isFinite(Number(row.season)) ? Number(row.season) : 2026,
    jsonUrl: typeof row.jsonUrl === "string" ? row.jsonUrl : "",
    lastSyncAt: typeof row.lastSyncAt === "string" ? row.lastSyncAt : null,
    lastSyncNote: typeof row.lastSyncNote === "string" ? row.lastSyncNote : null,
    unmatched: Array.isArray(row.unmatched) ? row.unmatched.filter((item) => item && typeof item.name === "string") : [],
    aliases: Array.isArray(row.aliases) ? row.aliases.filter((item) => item && typeof item.playerId === "string") : [],
  };
}

export async function readAvailabilitySettings(): Promise<{ settings: AvailabilitySettings; ready: boolean }> {
  const admin = createAdminSupabase();
  const row = await admin.from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  if (row.error) {
    if (missing(row.error.message)) return { settings: DEFAULTS, ready: false };
    throw new Error(row.error.message);
  }
  const settings = asSettings(row.data?.value);
  const system = await readSystemSettings();
  if (!system.ready) return { settings, ready: true };
  const provider = system.availabilityProvider === "manual"
    ? "manual"
    : system.availabilityProvider === "external-json"
      ? "external-json"
      : "api-football";
  return {
    settings: {
      ...settings,
      provider,
      leagueId: system.apiSportsLeagueId,
      season: system.apiSportsSeason,
    },
    ready: true,
  };
}

async function writeSettings(settings: AvailabilitySettings) {
  const admin = createAdminSupabase();
  const saved = await admin.from("app_settings").upsert({
    key: SETTINGS_KEY,
    value: settings,
    updated_at: new Date().toISOString(),
  });
  if (saved.error) {
    if (missing(saved.error.message)) throw httpError("Manca la tabella. Esegui player_availability.sql nell'editor SQL.", 503);
    throw new Error(saved.error.message);
  }
}

export async function saveAvailabilitySettings(patch: Partial<AvailabilitySettings>) {
  const current = await readAvailabilitySettings();
  if (!current.ready) throw httpError("Manca la tabella. Esegui player_availability.sql nell'editor SQL.", 503);
  const next = asSettings({ ...current.settings, ...patch, unmatched: current.settings.unmatched, aliases: patch.aliases ?? current.settings.aliases, lastSyncAt: current.settings.lastSyncAt, lastSyncNote: current.settings.lastSyncNote });
  await writeSettings(next);
  return next;
}

async function openMatchday() {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const weeks = await admin
    .from("gameweeks")
    .select("number, deadline_at, status")
    .eq("season_id", season.id)
    .order("number", { ascending: true });
  if (weeks.error) throw new Error(weeks.error.message);
  const open = (weeks.data ?? []).find((week) => week.status !== "scored" && week.status !== "final");
  return { seasonId: season.id, open: open ? { number: Number(open.number), deadlineAt: open.deadline_at as string, status: open.status as string } : null };
}

export async function syncAvailability(force = false) {
  const current = await readAvailabilitySettings();
  if (!current.ready) throw httpError("Manca la tabella. Esegui player_availability.sql nell'editor SQL.", 503);
  const settings = current.settings;
  const { seasonId, open } = await openMatchday();
  if (!open) return { skipped: true as const, reason: "Nessuna giornata aperta.", matchday: null, written: 0, unmatched: 0, changed: 0, samples: [] as string[] };
  const deadlinePassed = new Date(open.deadlineAt).getTime() <= Date.now();
  if (!force && deadlinePassed && open.status !== "scored" && open.status !== "final") {
    return { skipped: true as const, reason: "La giornata è già partita e non è ancora calcolata. Nessuna chiamata esterna.", matchday: open.number, written: 0, unmatched: 0, changed: 0, samples: [] as string[] };
  }
  if (settings.provider === "manual") {
    return { skipped: true as const, reason: "La fonte attiva è solo manuale.", matchday: open.number, written: 0, unmatched: 0, changed: 0, samples: [] as string[] };
  }
  const rows = await providerFor(settings.provider).load({
    leagueId: settings.leagueId,
    season: settings.season,
    jsonUrl: settings.jsonUrl,
  });
  const known = await knownPlayers(seasonId, open.number);
  const { matched, unmatched } = matchAvailability(rows, known, settings.aliases);
  const savedRows = await upsertAutomatic(open.number, matched, settings.provider);
  const next: AvailabilitySettings = {
    ...settings,
    lastSyncAt: new Date().toISOString(),
    lastSyncNote: `Giornata ${open.number}: ${savedRows.written} aggiornati, ${savedRows.changed} variati, ${unmatched.length} non abbinati.`,
    unmatched: unmatched.map((row) => ({ name: row.name, club: row.club, reason: row.reason })),
  };
  await writeSettings(next);
  return { skipped: false as const, reason: next.lastSyncNote, matchday: open.number, written: savedRows.written, unmatched: unmatched.length, changed: savedRows.changed, samples: savedRows.samples };
}

async function knownPlayers(seasonId: string, matchday: number): Promise<KnownPlayer[]> {
  const admin = createAdminSupabase();
  const regs = await admin
    .from("player_registrations")
    .select("player_id, club_id, effective_from_gameweek, effective_to_gameweek")
    .eq("season_id", seasonId);
  if (regs.error) throw new Error(regs.error.message);
  const current = new Map<string, { clubId: string; from: number }>();
  for (const row of regs.data ?? []) {
    const from = Number(row.effective_from_gameweek);
    const to = row.effective_to_gameweek == null ? null : Number(row.effective_to_gameweek);
    if (from > matchday || (to != null && to < matchday)) continue;
    const previous = current.get(row.player_id as string);
    if (!previous || from >= previous.from) current.set(row.player_id as string, { clubId: row.club_id as string, from });
  }
  const playerIds = [...current.keys()];
  const clubIds = [...new Set([...current.values()].map((item) => item.clubId))];
  if (playerIds.length === 0) return [];
  const [players, clubs] = await Promise.all([
    admin.from("players").select("id, full_name").in("id", playerIds),
    admin.from("clubs").select("id, code, club_translations(locale, name)").in("id", clubIds),
  ]);
  if (players.error) throw new Error(players.error.message);
  if (clubs.error) throw new Error(clubs.error.message);
  const names = new Map((players.data ?? []).map((row) => [row.id as string, row.full_name as string]));
  const clubNames = new Map((clubs.data ?? []).map((row) => {
    const translations = (row.club_translations ?? []) as { locale: string; name: string }[];
    const label = translations.find((item) => item.locale === "it") ?? translations[0];
    return [row.id as string, { code: row.code as string, name: label?.name || (row.code as string) }];
  }));
  return playerIds.flatMap((id) => {
    const club = clubNames.get(current.get(id)?.clubId ?? "");
    const fullName = names.get(id);
    if (!club || !fullName) return [];
    return [{ id, fullName, clubCode: club.code, clubName: club.name }];
  });
}

async function upsertAutomatic(
  matchday: number,
  matched: { playerId: string; row: { name: string; status: AvailabilityStatus; playProbability: number | null; reason: string | null } }[],
  source: string,
) {
  const admin = createAdminSupabase();
  const existing = await admin.from("player_availability").select("player_id, source_provider, status, play_probability").eq("matchday", matchday);
  if (existing.error) {
    if (missing(existing.error.message)) throw httpError("Manca la tabella. Esegui player_availability.sql nell'editor SQL.", 503);
    throw new Error(existing.error.message);
  }
  const previous = new Map((existing.data ?? []).map((row) => [row.player_id as string, row]));
  const manual = new Set((existing.data ?? []).filter((row) => row.source_provider === "manual").map((row) => row.player_id as string));
  const rows = matched
    .filter((item) => !manual.has(item.playerId))
    .map((item) => ({
      player_id: item.playerId,
      matchday,
      status: item.row.status,
      play_probability: item.row.playProbability,
      reason: item.row.reason,
      source_provider: source,
      updated_at: new Date().toISOString(),
    }));
  const keep = new Set(rows.map((row) => row.player_id));
  const stale = (existing.data ?? [])
    .filter((row) => row.source_provider !== "manual" && !keep.has(row.player_id as string))
    .map((row) => row.player_id as string);
  if (stale.length > 0) {
    const removed = await admin.from("player_availability").delete().eq("matchday", matchday).in("player_id", stale);
    if (removed.error) throw new Error(removed.error.message);
  }
  if (rows.length === 0) {
    return {
      written: 0,
      changed: stale.length,
      samples: stale.length ? [`Rimosse ${stale.length} indisponibilità non più in elenco`] : [],
    };
  }
  const saved = await admin.from("player_availability").upsert(rows, { onConflict: "player_id,matchday" });
  if (saved.error) throw new Error(saved.error.message);
  const names = new Map(matched.map((item) => [item.playerId, item.row.name]));
  const changedRows = rows.filter((row) => {
    const before = previous.get(row.player_id);
    if (!before || before.source_provider === "manual") return !before;
    return before.status !== row.status || Number(before.play_probability) !== Number(row.play_probability);
  });
  const labels: Record<string, string> = {
    suspended: "squalificato",
    injured: "indisponibile",
    doubt: "dubbio",
    bench: "panchina",
    starter: "titolare",
    available: "disponibile",
  };
  return {
    written: rows.length,
    changed: changedRows.length + stale.length,
    samples: [
      ...changedRows.slice(0, 5).map((row) => `${names.get(row.player_id) ?? "Giocatore"} ${labels[row.status] ?? row.status}`),
      ...(stale.length ? [`Rimosse ${stale.length} indisponibilità non più in elenco`] : []),
    ].slice(0, 5),
  };
}

export async function saveManualAvailability(input: {
  playerId: string;
  status: AvailabilityStatus;
  playProbability: number | null;
  reason: string | null;
}) {
  const { open } = await openMatchday();
  if (!open) throw httpError("Nessuna giornata aperta.", 409);
  const admin = createAdminSupabase();
  const saved = await admin.from("player_availability").upsert({
    player_id: input.playerId,
    matchday: open.number,
    status: input.status,
    play_probability: input.playProbability,
    reason: input.reason,
    source_provider: "manual",
    updated_at: new Date().toISOString(),
  }, { onConflict: "player_id,matchday" });
  if (saved.error) {
    if (missing(saved.error.message)) throw httpError("Manca la tabella. Esegui player_availability.sql nell'editor SQL.", 503);
    throw new Error(saved.error.message);
  }
  return open.number;
}

export async function saveAvailabilityAlias(alias: AvailabilityAlias) {
  const current = await readAvailabilitySettings();
  if (!current.ready) throw httpError("Manca la tabella. Esegui player_availability.sql nell'editor SQL.", 503);
  const aliases = current.settings.aliases.filter((item) => !(item.name === alias.name && item.club === alias.club));
  aliases.push(alias);
  await writeSettings({ ...current.settings, aliases });
}

export async function importNamedAvailability(rows: { name: string; club: string; status: AvailabilityStatus; playProbability: number | null; reason: string | null }[]) {
  const { seasonId, open } = await openMatchday();
  if (!open) throw httpError("Nessuna giornata aperta.", 409);
  const settings = await readAvailabilitySettings();
  const known = await knownPlayers(seasonId, open.number);
  const { matched, unmatched } = matchAvailability(rows, known, settings.settings.aliases);
  let written = 0;
  for (const item of matched) {
    await saveManualAvailability({
      playerId: item.playerId,
      status: item.row.status,
      playProbability: item.row.playProbability,
      reason: item.row.reason,
    });
    written += 1;
  }
  return { written, unmatched: unmatched.map((row) => ({ name: row.name, club: row.club })) };
}

export async function searchPlayers(query: string) {
  const needle = query.trim();
  if (needle.length < 2) return [];
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const rows = await admin.from("players").select("id, full_name").ilike("full_name", `%${needle}%`).limit(8);
  if (rows.error) return [];
  const known = await knownPlayers(season.id, 38);
  const clubs = new Map(known.map((player) => [player.id, player.clubName]));
  return (rows.data ?? []).map((row) => ({
    id: row.id as string,
    fullName: row.full_name as string,
    club: clubs.get(row.id as string) ?? "",
  }));
}

export async function attachAvailability(players: CatalogPlayer[], matchday: number) {
  try {
    const ids = players.map((player) => player.id);
    if (ids.length === 0) return players;
    const admin = createAdminSupabase();
    const rows = await admin
      .from("player_availability")
      .select("player_id, matchday, status, play_probability, reason")
      .eq("matchday", matchday)
      .in("player_id", ids);
    if (rows.error || !rows.data) return players;
    const marks = new Map(rows.data.filter((row) => Number(row.matchday) === matchday).map((row) => [row.player_id as string, row]));
    return players.map((player) => {
      const mark = marks.get(player.id);
      if (!mark) return player;
      return {
        ...player,
        availability: {
          status: mark.status as AvailabilityStatus,
          playProbability: mark.play_probability == null ? null : Number(mark.play_probability),
          reason: typeof mark.reason === "string" ? mark.reason : null,
        },
      };
    });
  } catch {
    return players;
  }
}
