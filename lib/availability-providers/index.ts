import { apiFootballProvider } from "@/lib/availability-providers/api-football";
import { externalJsonProvider, manualProvider } from "@/lib/availability-providers/external-json";
import { fantacalcioAvailabilityProvider } from "@/lib/availability-providers/fantacalcio";
import type { AvailabilityProvider } from "@/lib/availability-providers/types";

export type { AvailabilityProvider, AvailabilityStatus, ExternalAvailability } from "@/lib/availability-providers/types";

export function providerFor(id: string): AvailabilityProvider {
  if (id === "fantacalcio") return fantacalcioAvailabilityProvider;
  if (id === "external-json") return externalJsonProvider;
  if (id === "manual") return manualProvider;
  return apiFootballProvider;
}
