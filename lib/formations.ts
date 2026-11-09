import type { PlayerRole } from "@/lib/types";

export type FormationId = "3-4-3" | "3-5-2" | "4-3-3" | "4-4-2" | "4-5-1" | "5-3-2" | "5-4-1";

export type Formation = {
  id: FormationId;
  def: number;
  mid: number;
  fwd: number;
};

export const FORMATIONS: Formation[] = [
  { id: "3-4-3", def: 3, mid: 4, fwd: 3 },
  { id: "3-5-2", def: 3, mid: 5, fwd: 2 },
  { id: "4-3-3", def: 4, mid: 3, fwd: 3 },
  { id: "4-4-2", def: 4, mid: 4, fwd: 2 },
  { id: "4-5-1", def: 4, mid: 5, fwd: 1 },
  { id: "5-3-2", def: 5, mid: 3, fwd: 2 },
  { id: "5-4-1", def: 5, mid: 4, fwd: 1 },
];

const DEFAULT_FORMATION = FORMATIONS[2];

export type RoleCounts = Record<PlayerRole, number>;

type RosterPlayer = { id: string; role: PlayerRole };

export function formationById(id: FormationId) {
  return FORMATIONS.find((formation) => formation.id === id) ?? DEFAULT_FORMATION;
}

export function roleCap(formation: Formation, role: PlayerRole) {
  if (role === "GK") return 1;
  if (role === "DEF") return formation.def;
  if (role === "MID") return formation.mid;
  return formation.fwd;
}

export function countRoles(roster: RosterPlayer[], playerIds: string[]): RoleCounts {
  const counts: RoleCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const byId = new Map(roster.map((player) => [player.id, player]));
  for (const playerId of playerIds) {
    const player = byId.get(playerId);
    if (player) counts[player.role] += 1;
  }
  return counts;
}

export function fitsFormation(counts: RoleCounts, formation: Formation) {
  return counts.GK <= 1
    && counts.DEF <= formation.def
    && counts.MID <= formation.mid
    && counts.FWD <= formation.fwd;
}

export function inferFormation(counts: RoleCounts): Formation {
  const used = counts.GK + counts.DEF + counts.MID + counts.FWD;
  if (used === 0) return DEFAULT_FORMATION;
  const fitting = FORMATIONS.filter((formation) => fitsFormation(counts, formation));
  if (fitting.length === 0) return DEFAULT_FORMATION;
  return [...fitting].sort((left, right) => {
    const spareLeft = roleCap(left, "DEF") + roleCap(left, "MID") + roleCap(left, "FWD")
      - counts.DEF - counts.MID - counts.FWD;
    const spareRight = roleCap(right, "DEF") + roleCap(right, "MID") + roleCap(right, "FWD")
      - counts.DEF - counts.MID - counts.FWD;
    return spareLeft - spareRight || left.id.localeCompare(right.id);
  })[0];
}

export function trimToFormation(roster: RosterPlayer[], playerIds: string[], formation: Formation) {
  const used: RoleCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const byId = new Map(roster.map((player) => [player.id, player]));
  return playerIds.filter((playerId) => {
    const player = byId.get(playerId);
    if (!player) return false;
    if (used[player.role] >= roleCap(formation, player.role)) return false;
    used[player.role] += 1;
    return true;
  });
}

export function autoLineup(roster: RosterPlayer[]) {
  const byRole: Record<PlayerRole, RosterPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  const ordered = [...roster].sort((left, right) => left.id.localeCompare(right.id));
  for (const player of ordered) byRole[player.role].push(player);

  const score = (formation: Formation) =>
    Math.min(byRole.GK.length, 1)
    + Math.min(byRole.DEF.length, formation.def)
    + Math.min(byRole.MID.length, formation.mid)
    + Math.min(byRole.FWD.length, formation.fwd);

  const formation = [...FORMATIONS].sort((left, right) => {
    const delta = score(right) - score(left);
    if (delta !== 0) return delta;
    if (left.id === DEFAULT_FORMATION.id) return -1;
    if (right.id === DEFAULT_FORMATION.id) return 1;
    return left.id.localeCompare(right.id);
  })[0];

  if (!formation || score(formation) === 0) return null;

  const starters = [
    ...byRole.GK.slice(0, 1),
    ...byRole.DEF.slice(0, formation.def),
    ...byRole.MID.slice(0, formation.mid),
    ...byRole.FWD.slice(0, formation.fwd),
  ];
  const playerIds = starters.map((player) => player.id);
  const onPitch = new Set(playerIds);
  const benchIds = (["GK", "DEF", "MID", "FWD"] as PlayerRole[])
    .flatMap((role) => byRole[role])
    .map((player) => player.id)
    .filter((playerId) => !onPitch.has(playerId));

  return {
    formationId: formation.id,
    playerIds,
    benchIds,
    captainId: playerIds[0] ?? null,
    viceId: playerIds.length > 1 ? playerIds[1] ?? null : null,
  };
}

export function alphabeticalOfficeLineup(roster: { id: string; role: PlayerRole; name: string }[]) {
  const byName = (left: { id: string; name: string }, right: { id: string; name: string }) =>
    left.name.localeCompare(right.name, "it", { sensitivity: "base" }) || left.id.localeCompare(right.id);
  const byRole: Record<PlayerRole, { id: string; role: PlayerRole; name: string }[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const player of [...roster].sort(byName)) byRole[player.role].push(player);
  const score = (formation: Formation) =>
    Math.min(byRole.GK.length, 1)
    + Math.min(byRole.DEF.length, formation.def)
    + Math.min(byRole.MID.length, formation.mid)
    + Math.min(byRole.FWD.length, formation.fwd);
  const formation = [...FORMATIONS].sort((left, right) => {
    const delta = score(right) - score(left);
    if (delta !== 0) return delta;
    if (left.id === "4-4-2") return -1;
    if (right.id === "4-4-2") return 1;
    return left.id.localeCompare(right.id);
  })[0];
  if (!formation || score(formation) === 0) return null;
  const starters = [
    ...byRole.GK.slice(0, 1),
    ...byRole.DEF.slice(0, formation.def),
    ...byRole.MID.slice(0, formation.mid),
    ...byRole.FWD.slice(0, formation.fwd),
  ].sort(byName);
  const onPitch = new Set(starters.map((player) => player.id));
  const bench = roster.filter((player) => !onPitch.has(player.id)).sort(byName);
  return {
    formationId: formation.id,
    starterIds: starters.map((player) => player.id),
    benchIds: bench.map((player) => player.id),
    captainId: starters[0]?.id ?? null,
    viceId: starters[1]?.id ?? null,
  };
}

export function formationIssue(roster: RosterPlayer[], playerIds: string[]) {
  const unique = [...new Set(playerIds)];
  if (unique.length === 0) return "Schiera almeno un titolare.";
  if (unique.length > 11) return "I titolari sono al massimo 11.";
  const known = new Set(roster.map((player) => player.id));
  if (unique.some((playerId) => !known.has(playerId))) return "Ogni titolare deve essere in rosa per questa giornata.";
  const counts = countRoles(roster, unique);
  if (counts.GK > 1) return "In campo ci sta un solo portiere.";
  if (!FORMATIONS.some((formation) => fitsFormation(counts, formation))) {
    return `Modulo ${counts.DEF}-${counts.MID}-${counts.FWD} non ammesso. Scegli 3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2 o 5-4-1.`;
  }
  if (unique.length === 11 && counts.GK !== 1) return "Con 11 titolari serve un portiere.";
  return null;
}
