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

/** Nel listone gli omonimi hanno l'iniziale in coda: «Davis K.», «Pellegrini Lo.». */
function splitInitial(name: string) {
  const found = /^(.*\S)\s+(\p{L}{1,3})\.$/u.exec(name.normalize("NFC").trim());
  return found ? { base: found[1], initial: fold(found[2]) } : { base: name, initial: "" };
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
    const found = findBySurname(row.name, club, known);
    if (found) {
      matched.push({ playerId: found.id, row });
    } else {
      unmatched.push(row);
    }
  }
  return { matched, unmatched };
}

/** Il calciatore solo se il cognome ne indica uno e uno soltanto. */
function findBySurname(name: string, club: string | null, known: KnownPlayer[]) {
  const wanted = splitInitial(name);
  const last = surname(wanted.base);
  const sameSurname = wanted.initial ? [] : known.filter((player) => surname(player.fullName) === last);
  const hits = sameSurname.filter((player) => !club || player.clubCode === club);
  if (hits.length > 0) return hits.length === 1 ? hits[0] : null;
  // «Davis» è «Davis K.», ma solo dentro il suo club: due candidati restano da scegliere a mano.
  if (club) {
    const shortened = known.filter((player) => {
      const listed = splitInitial(player.fullName);
      return player.clubCode === club
        && listed.initial !== ""
        && surname(listed.base) === last
        && (listed.initial.startsWith(wanted.initial) || wanted.initial.startsWith(listed.initial));
    });
    if (shortened.length > 0) return shortened.length === 1 ? shortened[0] : null;
  }
  // Nessuno in quel club: vale il cognome unico in tutto il listone.
  return sameSurname.length === 1 ? sameSurname[0] : null;
}
