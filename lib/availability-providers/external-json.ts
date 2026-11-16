import { classifyStatus, probabilityOf, type AvailabilityProvider, type AvailabilityStatus, type ExternalAvailability } from "@/lib/availability-providers/types";

const STATUSES = new Set<AvailabilityStatus>(["available", "starter", "bench", "doubt", "injured", "suspended"]);

export const externalJsonProvider: AvailabilityProvider = {
  id: "external-json",
  async load(context) {
    const url = context.jsonUrl.trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error("L'URL del JSON deve iniziare con https://.");
    const response = await fetch(url, {
      headers: { "User-Agent": "Fantaventi/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Il JSON esterno ha risposto ${response.status}.`);
    const body = await response.json() as unknown;
    const rows = Array.isArray(body) ? body : [];
    return rows.flatMap((item): ExternalAvailability[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as { name?: unknown; club?: unknown; status?: unknown; playProbability?: unknown; reason?: unknown };
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const club = typeof row.club === "string" ? row.club.trim() : "";
      if (!name || !club) return [];
      const status = typeof row.status === "string" && STATUSES.has(row.status as AvailabilityStatus)
        ? row.status as AvailabilityStatus
        : classifyStatus("", typeof row.reason === "string" ? row.reason : "");
      return [{
        name,
        club,
        status,
        playProbability: probabilityOf(row.playProbability),
        reason: typeof row.reason === "string" ? row.reason.trim().slice(0, 160) : null,
      }];
    });
  },
};

export const manualProvider: AvailabilityProvider = {
  id: "manual",
  async load() {
    return [];
  },
};
