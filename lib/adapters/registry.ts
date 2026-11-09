import { createHash } from "node:crypto";
import { serieAVotesAdapter } from "@/lib/adapters/external/serie-a-votes";
import { fantacalcioListoneAdapter } from "@/lib/adapters/excel/fantacalcio-listone";
import { genericListoneAdapter } from "@/lib/adapters/excel/generic-listone";
import { fantacalcioVotesAdapter } from "@/lib/adapters/excel/fantacalcio-votes";
import type { AdapterSource, ListoneAdapter, ProviderInfo, VotesAdapter } from "@/lib/adapters/types";

const listoneAdapters = new Map<string, ListoneAdapter>([
  [fantacalcioListoneAdapter.id, fantacalcioListoneAdapter],
  [genericListoneAdapter.id, genericListoneAdapter],
]);

const votesAdapters = new Map<string, VotesAdapter>([
  [fantacalcioVotesAdapter.id, fantacalcioVotesAdapter],
  [serieAVotesAdapter.id, serieAVotesAdapter],
]);

export const DEFAULT_LISTONE_PROVIDER = fantacalcioListoneAdapter.id;
export const DEFAULT_VOTES_PROVIDER = fantacalcioVotesAdapter.id;

function providers(adapters: Map<string, { id: string; label: string }>): ProviderInfo[] {
  return [...adapters.values()].map((adapter) => ({ id: adapter.id, label: adapter.label }));
}

export function listoneProviders(): ProviderInfo[] {
  return providers(listoneAdapters);
}

export function votesProviders(): ProviderInfo[] {
  return providers(votesAdapters);
}

export function resolveListoneAdapter(id?: string | null): ListoneAdapter {
  const key = id?.trim() || DEFAULT_LISTONE_PROVIDER;
  const adapter = listoneAdapters.get(key);
  if (!adapter) {
    throw new Error(`Provider listone sconosciuto: ${key}. Disponibili: ${[...listoneAdapters.keys()].join(", ")}.`);
  }
  return adapter;
}

export function resolveVotesAdapter(id?: string | null): VotesAdapter {
  const key = id?.trim() || DEFAULT_VOTES_PROVIDER;
  const adapter = votesAdapters.get(key);
  if (!adapter) {
    throw new Error(`Provider voti sconosciuto: ${key}. Disponibili: ${[...votesAdapters.keys()].join(", ")}.`);
  }
  return adapter;
}

export function sourcePayloadHash(source: AdapterSource, normalized: unknown) {
  const hash = createHash("sha256");
  if (source.bytes && source.bytes.length > 0) hash.update(source.bytes);
  else hash.update(JSON.stringify(normalized));
  return hash.digest("hex");
}
