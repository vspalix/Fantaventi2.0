import type { CatalogPlayer, ClubRef, PlayerRole, RosterRules } from "@/lib/types";

export type RoleCount = Record<PlayerRole, number>;

export type ClubCount = ClubRef & { count: number };

export type ConstraintReport = {
  total: number;
  totalOk: boolean;
  clubs: ClubCount[];
  duplicateClubs: ClubCount[];
  missingClubs: ClubCount[];
  clubsOk: boolean;
  roles: RoleCount;
  rolesOk: boolean;
  ready: boolean;
};

const ROLES: PlayerRole[] = ["GK", "DEF", "MID", "FWD"];

export function countRoles(players: CatalogPlayer[]): RoleCount {
  const roles: RoleCount = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const player of players) roles[player.role] += 1;
  return roles;
}

export function evaluateRoster(
  selected: CatalogPlayer[],
  clubs: ClubRef[],
  rules: RosterRules,
): ConstraintReport {
  const roles = countRoles(selected);
  const byClub = new Map<string, number>();

  for (const player of selected) {
    byClub.set(player.clubId, (byClub.get(player.clubId) ?? 0) + 1);
  }

  const clubCounts = clubs.map((club) => ({
    ...club,
    count: byClub.get(club.id) ?? 0,
  }));
  const covered = clubCounts.reduce((sum, club) => sum + club.count, 0);
  const duplicateClubs = clubCounts.filter((club) => club.count > 1);
  const missingClubs = clubCounts.filter((club) => club.count === 0);
  const outsideClub = selected.length - covered;

  const totalOk = selected.length === rules.squadSize;
  const clubsOk =
    clubs.length === rules.squadSize &&
    duplicateClubs.length === 0 &&
    missingClubs.length === 0 &&
    outsideClub === 0;
  const rolesOk =
    roles.GK >= rules.gkMin &&
    roles.GK <= rules.gkMax &&
    roles.DEF >= rules.outfieldMin &&
    roles.DEF <= rules.outfieldMax &&
    roles.MID >= rules.outfieldMin &&
    roles.MID <= rules.outfieldMax &&
    roles.FWD >= rules.outfieldMin &&
    roles.FWD <= rules.outfieldMax;

  return {
    total: selected.length,
    totalOk,
    clubs: clubCounts,
    duplicateClubs,
    missingClubs,
    clubsOk,
    roles,
    rolesOk,
    ready: totalOk && clubsOk && rolesOk && ROLES.every((role) => roles[role] >= 0),
  };
}

export function roleInRange(role: PlayerRole, count: number, rules: RosterRules): boolean {
  if (role === "GK") return count >= rules.gkMin && count <= rules.gkMax;
  return count >= rules.outfieldMin && count <= rules.outfieldMax;
}
