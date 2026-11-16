export type AvailabilityStatus = "available" | "starter" | "bench" | "doubt" | "injured" | "suspended";

export type ExternalAvailability = {
  name: string;
  club: string;
  status: AvailabilityStatus;
  playProbability: number | null;
  reason: string | null;
};

export type ProviderContext = {
  leagueId: number;
  season: number;
  jsonUrl: string;
};

export type AvailabilityProvider = {
  id: "api-football" | "external-json" | "manual";
  load(context: ProviderContext): Promise<ExternalAvailability[]>;
};

export function classifyStatus(type: string, reason: string): AvailabilityStatus {
  const text = `${type} ${reason}`.toLowerCase();
  if (/suspend|squalif|red card|ban|stop/.test(text)) return "suspended";
  if (/doubt|dubbio|question/.test(text)) return "doubt";
  if (/bench|panchina/.test(text)) return "bench";
  if (/starter|titolar/.test(text)) return "starter";
  if (/available|disponib|fit/.test(text)) return "available";
  return "injured";
}

export function probabilityOf(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}
