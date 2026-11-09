import { fantapuntiToGoals, headToHeadPairings, type GoalBand } from "@/lib/league-rules";
import type { PlayerStat } from "@/lib/engine/calculator";

export type PitchEvent = {
  playerId: string;
  playerName: string;
  teamName: string;
  label: string;
};

export type BadgeAward = {
  kind: "pollo" | "re_bonus" | "rigorista";
  teamId: string;
  teamName: string;
  title: string;
  detail: string;
};

export type StandingSpot = {
  teamId: string;
  points: number;
};

const EVENT_WEIGHT: Record<string, number> = {
  gol: 1,
  "rigore segnato": 2,
  assist: 3,
  "rigore parato": 4,
  "rigore sbagliato": 5,
  autogol: 6,
  ammonizione: 7,
  espulsione: 8,
};

export function pitchEvents(rows: { playerId: string; playerName: string; teamName: string; stat: PlayerStat }[]): PitchEvent[] {
  const events: (PitchEvent & { weight: number })[] = [];
  for (const row of rows) {
    const push = (count: number, label: string) => {
      if (count <= 0) return;
      events.push({
        playerId: row.playerId,
        playerName: row.playerName,
        teamName: row.teamName,
        label: count > 1 ? `${count} ${label}` : label,
        weight: EVENT_WEIGHT[label] ?? 9,
      });
    };
    push(row.stat.goals ?? 0, "gol");
    push(row.stat.penaltiesScored ?? 0, "rigore segnato");
    push(row.stat.assists ?? 0, "assist");
    push(row.stat.penaltiesSaved ?? 0, "rigore parato");
    push(row.stat.penaltiesMissed ?? 0, "rigore sbagliato");
    push(row.stat.ownGoals ?? 0, "autogol");
    push(row.stat.yellowCards ?? 0, "ammonizione");
    push(row.stat.redCards ?? 0, "espulsione");
  }
  return events
    .sort((left, right) => left.weight - right.weight || left.playerName.localeCompare(right.playerName, "it"))
    .map(({ weight: _weight, ...event }) => event);
}

export function heavyMalus(stat: PlayerStat) {
  return (stat.penaltiesMissed ?? 0) * 3 + (stat.redCards ?? 0) + (stat.ownGoals ?? 0) * 2;
}

export function bonusWeight(stat: PlayerStat) {
  return (stat.goals ?? 0) * 3
    + (stat.assists ?? 0)
    + (stat.penaltiesScored ?? 0) * 3
    + (stat.penaltiesSaved ?? 0) * 3;
}

export function awardBadges(rows: { teamId: string; teamName: string; benchBonus: number; bonus: number; heavy: number }[]): BadgeAward[] {
  const best = (pick: (row: { teamId: string; teamName: string; benchBonus: number; bonus: number; heavy: number }) => number) => {
    const ranked = [...rows].filter((row) => pick(row) > 0).sort((left, right) => (
      pick(right) - pick(left) || left.teamName.localeCompare(right.teamName, "it")
    ));
    return ranked[0] ?? null;
  };
  const pollo = best((row) => row.benchBonus);
  const re = best((row) => row.bonus);
  const rigorista = best((row) => row.heavy);
  const awards: BadgeAward[] = [];
  if (pollo) {
    awards.push({
      kind: "pollo",
      teamId: pollo.teamId,
      teamName: pollo.teamName,
      title: "Il Pollo della Settimana",
      detail: `${pollo.teamName} ha lasciato in panchina ${pollo.benchBonus} punti di bonus.`,
    });
  }
  if (re) {
    awards.push({
      kind: "re_bonus",
      teamId: re.teamId,
      teamName: re.teamName,
      title: "Il Re dei Bonus",
      detail: `${re.teamName} ha raccolto ${re.bonus} punti di bonus in campo.`,
    });
  }
  if (rigorista) {
    awards.push({
      kind: "rigorista",
      teamId: rigorista.teamId,
      teamName: rigorista.teamName,
      title: "Il Rigorista Maledetto",
      detail: `${rigorista.teamName} ha subito il malus più pesante della giornata.`,
    });
  }
  return awards;
}

function ranks(rows: StandingSpot[]) {
  const sorted = [...rows].sort((left, right) => right.points - left.points || left.teamId.localeCompare(right.teamId));
  return new Map(sorted.map((row, index) => [row.teamId, index]));
}

export function overtakes(before: StandingSpot[], after: StandingSpot[]) {
  const previous = ranks(before);
  const next = ranks(after);
  const moves: { teamId: string; byTeamId: string }[] = [];
  for (const row of after) {
    const was = previous.get(row.teamId);
    const now = next.get(row.teamId);
    if (was === undefined || now === undefined || now <= was) continue;
    const passer = after.find((other) => {
      const otherWas = previous.get(other.teamId);
      const otherNow = next.get(other.teamId);
      return otherWas !== undefined && otherNow !== undefined && otherWas > was && otherNow < now;
    });
    if (passer) moves.push({ teamId: row.teamId, byTeamId: passer.teamId });
  }
  return moves;
}

export function h2hFlips(
  teamIds: string[],
  weekNumber: number,
  before: Map<string, number>,
  after: Map<string, number>,
  bands?: readonly GoalBand[],
) {
  const score = (points: number) => (bands && bands.length > 0 ? fantapuntiToGoals(points, bands) : points);
  const flips: { winner: string; loser: string }[] = [];
  for (const pair of headToHeadPairings(teamIds, weekNumber).pairs) {
    const beforeHome = score(before.get(pair.home) ?? 0);
    const beforeAway = score(before.get(pair.away) ?? 0);
    const afterHome = score(after.get(pair.home) ?? 0);
    const afterAway = score(after.get(pair.away) ?? 0);
    const beforeLeader = beforeHome === beforeAway ? null : beforeHome > beforeAway ? pair.home : pair.away;
    const afterLeader = afterHome === afterAway ? null : afterHome > afterAway ? pair.home : pair.away;
    if (beforeLeader && afterLeader && beforeLeader !== afterLeader) {
      flips.push({ winner: afterLeader, loser: beforeLeader });
    }
  }
  return flips;
}
