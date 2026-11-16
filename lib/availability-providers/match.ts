import { SERIE_A_CLUBS } from "@/lib/club-colors";
import type { ExternalAvailability } from "@/lib/availability-providers/types";

export type KnownPlayer = {
  id: string;
  fullName: string;
  clubCode: string;
  clubName: string;
};

export type AvailabilityAlias = {
  name: string;
  club: string;
  playerId: string;
};

export function fold(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function surname(name: string) {
  const parts = fold(name).split(" ").filter(Boolean);
  return parts.at(-1) ?? "";
}

export function resolveClub(label: string) {
  const folded = fold(label);
  if (!folded) return null;
  const exact = SERIE_A_CLUBS.find((club) => fold(club.name) === folded || fold(club.code) === folded || fold(club.short) === folded);
  if (exact) return exact.code;
  const names = [...SERIE_A_CLUBS].sort((left, right) => right.name.length - left.name.length);
  return names.find((club) => folded.includes(fold(club.name)))?.code ?? null;
}

export function matchAvailability(
  rows: ExternalAvailability[],
  known: KnownPlayer[],
  aliases: AvailabilityAlias[],
) {
  const matched: { playerId: string; row: ExternalAvailability }[] = [];
  const unmatched: ExternalAvailability[] = [];
  for (const row of rows) {
    const club = resolveClub(row.club);
    const alias = aliases.find((item) => fold(item.name) === fold(row.name) && resolveClub(item.club) === club);
    if (alias && known.some((player) => player.id === alias.playerId)) {
      matched.push({ playerId: alias.playerId, row });
      continue;
    }
    const last = surname(row.name);
    const hits = known.filter((player) => surname(player.fullName) === last && (!club || player.clubCode === club));
    const unique = hits.length === 1 ? hits : known.filter((player) => surname(player.fullName) === last);
    if (hits.length === 1 || (hits.length === 0 && unique.length === 1)) {
      matched.push({ playerId: (hits[0] ?? unique[0]).id, row });
    } else {
      unmatched.push(row);
    }
  }
  return { matched, unmatched };
}
