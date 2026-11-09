import { evaluateRoster } from "@/lib/constraints";
import type { CatalogPlayer, ClubRef, PlayerRole, RosterRules } from "@/lib/types";

const ROLES: PlayerRole[] = ["GK", "DEF", "MID", "FWD"];

function takeRole(pool: CatalogPlayer[], role: PlayerRole, teamIndex: number) {
  const matching = pool.filter((player) => player.role === role);
  if (matching.length === 0) return null;
  return matching[teamIndex % matching.length] ?? null;
}

export function buildLegalRoster(
  players: CatalogPlayer[],
  clubs: ClubRef[],
  rules: RosterRules,
  teamIndex: number,
) {
  if (clubs.length !== rules.squadSize) {
    throw new Error(`Il listone ha ${clubs.length} club e la rosa ne prevede ${rules.squadSize}.`);
  }
  const byClub = new Map<string, CatalogPlayer[]>();
  for (const player of players) {
    const list = byClub.get(player.clubId) ?? [];
    list.push(player);
    byClub.set(player.clubId, list);
  }
  const ordered = [...clubs].sort((left, right) => left.code.localeCompare(right.code));
  const rotated = ordered.map((_, index) => ordered[(index + teamIndex) % ordered.length]).filter((club) => club !== undefined);
  const picked: CatalogPlayer[] = [];
  if (rules.squadSize === 20) {
    const remaining: Record<PlayerRole, number> = { GK: 3, DEF: 6, MID: 6, FWD: 5 };
    const rest = [...rotated];
    for (const role of ROLES) {
      let need = remaining[role];
      for (let index = 0; index < rest.length && need > 0;) {
        const club = rest[index];
        if (!club) break;
        const choice = takeRole(byClub.get(club.id) ?? [], role, teamIndex);
        if (!choice) {
          index += 1;
          continue;
        }
        picked.push(choice);
        rest.splice(index, 1);
        need -= 1;
      }
      if (need > 0) throw new Error(`Nel listone mancano ${need} ${role}.`);
    }
  } else {
    for (const club of rotated) {
      const pool = byClub.get(club.id) ?? [];
      const choice = pool[teamIndex % Math.max(pool.length, 1)];
      if (!choice) throw new Error(`Manca un calciatore per ${club.code}.`);
      picked.push(choice);
    }
  }
  const report = evaluateRoster(picked, clubs, rules);
  if (!report.ready || report.duplicateClubs.length > 0) {
    throw new Error("La rosa generata non rispetta un calciatore per club o i limiti di ruolo.");
  }
  return picked;
}
