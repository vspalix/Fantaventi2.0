import { apiFootballProvider } from "@/lib/availability-providers/api-football";
import { externalJsonProvider, manualProvider } from "@/lib/availability-providers/external-json";
import type { AvailabilityProvider } from "@/lib/availability-providers/types";

export type { AvailabilityProvider, AvailabilityStatus, ExternalAvailability } from "@/lib/availability-providers/types";

export function providerFor(id: string): AvailabilityProvider {
  if (id === "external-json") return externalJsonProvider;
  if (id === "manual") return manualProvider;
  return apiFootballProvider;
}
