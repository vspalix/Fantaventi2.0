import type { AvailabilityStatus } from "@/lib/availability-providers";
import { providerFor } from "@/lib/availability-providers";
import { fold, matchAvailability, type AvailabilityAlias, type KnownPlayer } from "@/lib/availability-providers/match";
import { decideAvailabilitySync, deliverAvailabilityNotices, reconcileAutomaticRows } from "@/lib/server/availability-plan";
import { getCurrentSeason } from "@/lib/server/catalog";
import { readSystemSettings } from "@/lib/server/system-settings";
import type { CatalogPlayer } from "@/lib/types";
import { createAdminSupabase } from "@/lib/supabase/admin";

const SETTINGS_KEY = "availability";

export type AvailabilitySettings = {
  provider: "api-football" | "fantacalcio" | "external-json" | "manual";
  leagueId: number;
  season: number;
  jsonUrl: string;
  lastSyncAt: string | null;
  lastSyncNote: string | null;
  unmatched: { name: string; club: string; status: string; reason: string | null }[];
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

function providerFromSystem(value: string): AvailabilitySettings["provider"] {
  if (value === "fantacalcio" || value === "external-json" || value === "manual") return value;
  return "api-football";
}

function asSettings(value: unknown): AvailabilitySettings {
  const row = (value ?? {}) as Partial<AvailabilitySettings>;
  const provider = row.provider === "fantacalcio" || row.provider === "external-json" || row.provider === "manual"
    ? row.provider
    : "api-football";
  return {
    provider,
    leagueId: Number.isFinite(Number(row.leagueId)) ? Number(row.leagueId) : 135,
    season: Number.isFinite(Number(row.season)) ? Number(row.season) : 2026,
    jsonUrl: typeof row.jsonUrl === "string" ? row.jsonUrl : "",
    lastSyncAt: typeof row.lastSyncAt === "string" ? row.lastSyncAt : null,
    lastSyncNote: typeof row.lastSyncNote === "string" ? row.lastSyncNote : null,
    unmatched: Array.isArray(row.unmatched) ? row.unmatched.flatMap((item) => {
      if (!item || typeof item.name !== "string") return [];
      const status = typeof item.status === "string" ? item.status : "";
      return [{ name: item.name, club: typeof item.club === "string" ? item.club : "", status, reason: typeof item.reason === "string" ? item.reason : null }];
    }) : [],
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
  const provider = providerFromSystem(system.availabilityProvider);
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
  await rememberProvider(next.provider);
  return next;
}

async function rememberProvider(provider: AvailabilitySettings["provider"]) {
  const stored = provider === "api-football" ? "api-sports" : provider;
  const admin = createAdminSupabase();
  const saved = await admin.from("system_settings").update({
    availability_provider: stored,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (saved.error && !missing(saved.error.message)) throw new Error(saved.error.message);
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
  const rows = weeks.data ?? [];
  const now = Date.now();
  const playable = rows.find((week) => {
    const deadline = new Date(week.deadline_at as string).getTime();
    return (week.status === "open" || week.status === "scheduled") && Number.isFinite(deadline) && deadline > now;
  });
  const latestUnscored = [...rows].reverse().find((week) => week.status !== "scored" && week.status !== "final");
  const open = playable ?? latestUnscored;
  return { seasonId: season.id, open: open ? { number: Number(open.number), deadlineAt: open.deadline_at as string, status: open.status as string } : null };
}

type AvailabilityDeps = {
  read: typeof readAvailabilitySettings;
  open: typeof openMatchday;
  load: (settings: AvailabilitySettings) => Promise<{ name: string; club: string; status: AvailabilityStatus; playProbability: number | null; reason: string | null }[]>;
  commit: typeof commitAvailability;
};

function skipped(reason: string, matchday: number | null) {
  return { skipped: true as const, reason, matchday, written: 0, unmatched: 0, changed: 0, samples: [] as string[] };
}

export async function runAvailabilitySync(force: boolean, deps: AvailabilityDeps, now = Date.now()) {
  const current = await deps.read();
  if (!current.ready) {
    const missingTable = decideAvailabilitySync({ ready: false, provider: current.settings.provider, force, open: null, now });
    if (missingTable.action === "error") throw httpError(missingTable.message, missingTable.status);
  }
  const opened = await deps.open();
  const decision = decideAvailabilitySync({
    ready: current.ready,
    provider: current.settings.provider,
    force,
    open: opened.open,
    now,
  });
  if (decision.action === "error") throw httpError(decision.message, decision.status);
  if (decision.action === "skip") return skipped(decision.reason, decision.matchday);
  const rows = await deps.load(current.settings);
  return deps.commit(current.settings, opened.seasonId, opened.open!, rows);
}

export async function syncAvailability(force = false) {
  return runAvailabilitySync(force, {
    read: readAvailabilitySettings,
    open: openMatchday,
    load: (settings) => providerFor(settings.provider).load({
      leagueId: settings.leagueId,
      season: settings.season,
      jsonUrl: settings.jsonUrl,
    }),
    commit: commitAvailability,
  });
}

async function commitAvailability(
  settings: AvailabilitySettings,
  seasonId: string,
  open: { number: number; deadlineAt: string; status: string },
  rows: { name: string; club: string; status: AvailabilityStatus; playProbability: number | null; reason: string | null }[],
) {
  const known = await knownPlayers(seasonId, open.number);
  const { matched, unmatched } = matchAvailability(rows, known, settings.aliases);
  const savedRows = await upsertAutomatic(open.number, matched, settings.provider);
  const next: AvailabilitySettings = {
    ...settings,
    lastSyncAt: new Date().toISOString(),
    lastSyncNote: `Giornata ${open.number}: ${savedRows.written} aggiornati, ${savedRows.changed} variati, ${unmatched.length} non abbinati.`,
    unmatched: unmatched.map((row) => ({ name: row.name, club: row.club, status: row.status, reason: row.reason })),
  };
  await writeSettings(next);
  const { alertAvailabilityWrites, alertUnmatchedAvailability } = await import("@/lib/server/telegram-alert");
  await deliverAvailabilityNotices(() => alertAvailabilityWrites({
    matchday: open.number,
    written: savedRows.written,
    changed: savedRows.changed,
    samples: savedRows.samples,
  }));
  await deliverAvailabilityNotices(() => alertUnmatchedAvailability(
    unmatched.map((row) => ({ name: row.name, club: row.club, status: row.status })),
    open.number,
  ));
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
  const plan = reconcileAutomaticRows({
    matched: matched.map((item) => ({ playerId: item.playerId, status: item.row.status, playProbability: item.row.playProbability })),
    existing: (existing.data ?? []).map((row) => ({
      playerId: row.player_id as string,
      sourceProvider: String(row.source_provider ?? ""),
      status: String(row.status ?? ""),
      playProbability: row.play_probability == null ? null : Number(row.play_probability),
    })),
  });
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
  const stale = plan.stale;
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
  const changedIds = new Set(plan.changedIds);
  const changedRows = rows.filter((row) => changedIds.has(row.player_id));
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
  const aliases = current.settings.aliases.filter((item) => !(fold(item.name) === fold(alias.name) && fold(item.club) === fold(alias.club)));
  aliases.push(alias);
  const unmatched = current.settings.unmatched.filter((item) => !(fold(item.name) === fold(alias.name) && fold(item.club) === fold(alias.club)));
  await writeSettings({ ...current.settings, aliases, unmatched });
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
