import { classifyStatus, probabilityOf, type AvailabilityProvider, type ExternalAvailability } from "@/lib/availability-providers/types";

type InjuryRow = {
  player?: { name?: string; type?: string; reason?: string };
  team?: { name?: string };
  fixture?: { date?: string };
};

export function apiFootballFailure(errors: unknown) {
  if (!errors) return null;
  if (typeof errors === "string") return errors.trim() || null;
  if (Array.isArray(errors)) {
    const text = errors.map((item) => String(item).trim()).filter(Boolean);
    return text.length ? text.join(" ") : null;
  }
  if (typeof errors === "object") {
    const parts = Object.entries(errors as Record<string, unknown>).flatMap(([key, value]) => {
      if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return [];
      return [`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`];
    });
    return parts.length ? parts.join(" ") : null;
  }
  return null;
}

export const apiFootballProvider: AvailabilityProvider = {
  id: "api-football",
  async load(context) {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) throw new Error("Manca API_FOOTBALL_KEY sul server.");
    const url = new URL("https://v3.football.api-sports.io/injuries");
    url.searchParams.set("league", String(context.leagueId || 135));
    url.searchParams.set("season", String(context.season || 2026));
    const response = await fetch(url, {
      headers: {
        "x-apisports-key": key,
        "User-Agent": "Fantaventi/1.0",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`API-Football ha risposto ${response.status}.`);
    const body = await response.json() as { response?: InjuryRow[]; errors?: unknown };
    const failure = apiFootballFailure(body.errors);
    if (failure) throw new Error(`API-Football ha rifiutato la richiesta (${failure}). Nessun aggiornamento.`);
    const rows = Array.isArray(body.response) ? body.response : [];
    const seen = new Map<string, ExternalAvailability>();
    for (const row of rows) {
      const name = row.player?.name?.trim() ?? "";
      const club = row.team?.name?.trim() ?? "";
      if (!name || !club) continue;
      const reason = row.player?.reason?.trim() || row.player?.type?.trim() || null;
      const item: ExternalAvailability = {
        name,
        club,
        status: classifyStatus(row.player?.type ?? "", row.player?.reason ?? ""),
        playProbability: probabilityOf((row.player as { playProbability?: unknown } | undefined)?.playProbability),
        reason,
      };
      seen.set(`${name}|${club}`, item);
    }
    return [...seen.values()];
  },
};
