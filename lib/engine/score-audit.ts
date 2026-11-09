import {
  defenseBreakdown,
  playingEleven,
  projectLiveScore,
  scoreLineup,
  type LineupSlotInput,
  type PlayerStat,
  type RulesetDefinition,
  type SubstitutionTrace,
  type TeamScore,
} from "@/lib/engine/calculator";
import { BONUS_FIELDS, fantapuntiToGoals, headToHeadPairings, type GoalBand, type LeagueRules } from "@/lib/league-rules";
import type { PlayerRole } from "@/lib/types";

export type AuditLine = {
  label: string;
  count: number;
  unit: number;
  points: number;
};

export type AuditPlayer = {
  playerId: string;
  name: string;
  role: PlayerRole;
  baseVote: number | null;
  lines: AuditLine[];
  malusFactor: number;
  fantavoto: number | null;
  captain: boolean;
  source: "starter" | "substitute" | "bench";
  replacedId: string | null;
  replacedName: string | null;
};

export type AuditSubstitution = SubstitutionTrace & {
  starterName: string;
  starterRole: PlayerRole | null;
  entrantName: string | null;
  entrantRole: PlayerRole | null;
  text: string;
};

export type ScoreAudit = {
  fantasyTeamId: string;
  teamName: string;
  gameweekNumber: number;
  mode: "official" | "provisional";
  players: AuditPlayer[];
  substitutions: AuditSubstitution[];
  modifiers: {
    captain: { name: string | null; vote: number | null; points: number; note: string };
    fairPlay: { points: number; note: string };
    defense: {
      enabled: boolean;
      basis: "voto" | "fantavoto";
      average: number | null;
      modifier: number;
      note: string;
      rows: { playerId: string; name: string; role: PlayerRole; value: number; used: boolean }[];
    };
    reserve: { unfilled: number; shortfall: number; unit: number; points: number; note: string };
  };
  sum: {
    playersPoints: number;
    captain: number;
    fairPlay: number;
    defense: number;
    reserve: number;
    total: number;
    storedTotal: number | null;
    delta: number | null;
  };
  result: {
    ranking: LeagueRules["ranking"];
    goalConversion: { applied: boolean; note: string };
    fixture: {
      kind: "sum" | "match" | "bye";
      opponentId: string | null;
      opponentName: string | null;
      opponentTotal: number | null;
      points: number | null;
      note: string;
    };
  };
};

type Totals = { fantasyTeamId: string; teamName: string; total: number };

const EVENT_FIELDS: { key: (typeof BONUS_FIELDS)[number]["key"]; stat: keyof PlayerStat; gkOnly?: boolean }[] = [
  { key: "goal", stat: "goals" },
  { key: "assist", stat: "assists" },
  { key: "penalty_scored", stat: "penaltiesScored" },
  { key: "penalty_saved", stat: "penaltiesSaved" },
  { key: "yellow_card", stat: "yellowCards" },
  { key: "red_card", stat: "redCards" },
  { key: "penalty_missed", stat: "penaltiesMissed" },
  { key: "own_goal", stat: "ownGoals" },
  { key: "goal_conceded", stat: "goalsConceded", gkOnly: true },
];

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nameOf(names: Map<string, string>, playerId: string) {
  return names.get(playerId) ?? playerId.slice(0, 8);
}

function roleLabel(role: PlayerRole | null) {
  if (role === "GK") return "portiere";
  if (role === "DEF") return "difensore";
  if (role === "MID") return "centrocampista";
  if (role === "FWD") return "attaccante";
  return "giocatore";
}

function eventLines(stat: PlayerStat | undefined, role: PlayerRole, definition: RulesetDefinition, political: boolean) {
  if (political) return [{ label: "6 politico, senza bonus né malus", count: 1, unit: 0, points: 0 }];
  if (!stat || stat.voto == null) return [];
  const catalog = definition.bonus_malus ?? {};
  const lines: AuditLine[] = [];
  for (const event of EVENT_FIELDS) {
    if (event.gkOnly && role !== "GK") continue;
    const count = Number(stat[event.stat] ?? 0);
    if (!Number.isFinite(count) || count === 0) continue;
    const unit = catalog[event.key] ?? 0;
    const field = BONUS_FIELDS.find((item) => item.key === event.key);
    lines.push({
      label: field?.label ?? event.key,
      count,
      unit,
      points: round2(count * unit),
    });
  }
  const cleanSheet = definition.clean_sheet;
  if (!political && role === "GK" && cleanSheet?.enabled && stat?.voto != null && (stat.goalsConceded ?? 0) === 0) {
    const points = cleanSheet.points ?? 0;
    lines.push({ label: "Imbattibilità portiere", count: 1, unit: points, points });
  }
  return lines;
}

function substitutionText(
  step: SubstitutionTrace,
  starterName: string,
  starterRole: PlayerRole | null,
  entrantName: string | null,
  entrantRole: PlayerRole | null,
  emptyPoints: number,
) {
  if (step.outcome === "kept") return `${starterName} ha un voto e resta titolare.`;
  const order = step.benchOrder == null ? "in panchina" : `panchina ${step.benchOrder}`;
  if (step.outcome === "same-role" && entrantName) {
    return `${starterName} è S.V. Entra ${entrantName}, stesso ruolo, ${order}.`;
  }
  if (step.outcome === "module-switch" && entrantName) {
    return `${starterName} è S.V. Nessun ${roleLabel(starterRole)} in panchina con voto. Entra ${entrantName} (${roleLabel(entrantRole)}), ${order}: il modulo resta valido.`;
  }
  return `${starterName} è S.V. I cambi possibili sono finiti. Resta senza voto: posto vuoto da ${emptyPoints} punti.`;
}

export function explainScore(input: {
  fantasyTeamId: string;
  teamName: string;
  gameweekNumber: number;
  slots: LineupSlotInput[];
  stats: Map<string, PlayerStat>;
  definition: RulesetDefinition;
  names: Map<string, string>;
  mode: "official" | "provisional";
  matchFinished: ReadonlySet<string>;
  ranking: LeagueRules["ranking"];
  goalBands?: readonly GoalBand[];
  totals: Totals[];
  storedTotal: number | null;
}): ScoreAudit {
  const { slots, stats, definition } = input;
  const projection = input.mode === "provisional";
  const plain = new Map([...stats].map(([id, stat]) => [id, { ...stat, postponed: false }]));
  const holeIds = projection ? new Set<string>() : undefined;
  const slotsForScore = projection ? slots.map((slot) => ({ ...slot, isCaptain: false, isVice: false })) : slots;
  const played = playingEleven(slotsForScore, projection ? plain : stats, definition.lineup_size ?? 11, holeIds);
  const score: TeamScore = projection
    ? projectLiveScore(input.fantasyTeamId, "audit", slots, stats, definition)
    : scoreLineup(input.fantasyTeamId, slots, stats, definition);
  const byPlayed = new Map(score.players.map((player) => [player.playerId, player]));
  const replacedBy = new Map<string, string>();
  for (const step of played.trace) {
    if (step.entrantId) replacedBy.set(step.entrantId, step.starterId);
  }
  const emptyUnit = definition.empty_slot_points ?? 0;
  const players: AuditPlayer[] = played.xi.map((slot) => {
    const scored = byPlayed.get(slot.playerId);
    const stat = stats.get(slot.playerId);
    const role = scored?.role ?? slot.role ?? stat?.role ?? "MID";
    const political = !projection && Boolean(stat?.voto == null && stat?.postponed && definition.postponement === "political_six");
    const lines = eventLines(stat, role, definition, political);
    if (scored && scored.malusFactor === 2 && scored.malusPoints !== 0) {
      lines.push({
        label: "Raddoppio malus capitano",
        count: 1,
        unit: scored.malusPoints,
        points: scored.malusPoints,
      });
    }
    const replacedId = replacedBy.get(slot.playerId) ?? null;
    return {
      playerId: slot.playerId,
      name: nameOf(input.names, slot.playerId),
      role,
      baseVote: scored?.voto ?? null,
      lines,
      malusFactor: scored?.malusFactor ?? 1,
      fantavoto: scored?.playerPoints ?? null,
      captain: Boolean(scored?.isEffectiveCaptain),
      source: replacedId ? "substitute" : "starter",
      replacedId,
      replacedName: replacedId ? nameOf(input.names, replacedId) : null,
    };
  });
  const onField = new Set(played.xi.map((slot) => slot.playerId));
  for (const slot of slots) {
    if (onField.has(slot.playerId)) continue;
    const stat = stats.get(slot.playerId);
    const role = slot.role ?? stat?.role ?? "MID";
    players.push({
      playerId: slot.playerId,
      name: nameOf(input.names, slot.playerId),
      role,
      baseVote: stat?.voto ?? null,
      lines: [{ label: "In panchina, fuori dal totale", count: 1, unit: 0, points: 0 }, ...eventLines(stat, role, definition, false)],
      malusFactor: 1,
      fantavoto: null,
      captain: false,
      source: "bench",
      replacedId: null,
      replacedName: null,
    });
  }

  const substitutions = played.trace
    .filter((step) => step.outcome !== "kept")
    .map((step) => {
      const starterRole = slots.find((slot) => slot.playerId === step.starterId)?.role
        ?? stats.get(step.starterId)?.role
        ?? null;
      const entrantRole = step.entrantId
        ? (stats.get(step.entrantId)?.role ?? slots.find((slot) => slot.playerId === step.entrantId)?.role ?? null)
        : null;
      const starterName = nameOf(input.names, step.starterId);
      const entrantName = step.entrantId ? nameOf(input.names, step.entrantId) : null;
      return {
        ...step,
        starterName,
        starterRole,
        entrantName,
        entrantRole,
        text: substitutionText(step, starterName, starterRole, entrantName, entrantRole, emptyUnit),
      };
    });

  const defense = defenseBreakdown(score.players, definition);
  const defenseRows = score.players
    .filter((player) => player.playerId === defense.keeperId || defense.defenderIds.includes(player.playerId))
    .map((player) => ({
      playerId: player.playerId,
      name: nameOf(input.names, player.playerId),
      role: player.role,
      value: defense.basis === "fantavoto" ? (player.fantavoto ?? 0) : (player.voto ?? 0),
      used: defense.chosenIds.includes(player.playerId),
    }));

  const captainPlayer = score.captainPlayerId ? byPlayed.get(score.captainPlayerId) : undefined;
  const captainName = score.captainPlayerId ? nameOf(input.names, score.captainPlayerId) : null;
  const fairBroken = score.fairPlay === 0 && score.players.some((player) => player.voto !== null && player.yellowCards > 0);
  const fairNote = projection
    ? "Il fair play non entra nella proiezione. Resta nel calcolo ufficiale."
    : fairBroken
      ? "Un giocatore con voto ha un'ammonizione: fair play 0."
      : score.players.some((player) => player.voto !== null)
        ? `Nessuna ammonizione tra chi ha un voto: ${score.fairPlay}.`
        : "Nessun voto in formazione: fair play 0.";
  const captainNote = projection
    ? "Il bonus capitano non entra nella proiezione. Il malus resta quello della voce, senza raddoppio."
    : captainPlayer
      ? `${captainName} è il capitano effettivo, voto ${captainPlayer.voto}. Fascia ${score.captainModifier}.`
      : "Nessun capitano con voto: fascia 0.";

  const shortfall = Math.max((definition.lineup_size ?? 11) - played.starters.length, 0);
  const reserveNote = score.reservePoints === 0
    ? "Nessun posto vuoto."
    : `${played.unfilledHoles} cambi non fatti e ${shortfall} slot scoperti, ${emptyUnit} punti ciascuno.`;

  const storedTotal = input.storedTotal;
  const delta = storedTotal == null ? null : round2(score.total - storedTotal);
  const bands = input.ranking === "head_to_head" ? input.goalBands ?? [] : [];
  const fixture = fixtureFor(input.fantasyTeamId, input.teamName, input.gameweekNumber, input.ranking, input.totals, score.total, bands);

  return {
    fantasyTeamId: input.fantasyTeamId,
    teamName: input.teamName,
    gameweekNumber: input.gameweekNumber,
    mode: input.mode,
    players,
    substitutions,
    modifiers: {
      captain: {
        name: captainName,
        vote: captainPlayer?.voto ?? null,
        points: score.captainModifier,
        note: captainNote,
      },
      fairPlay: { points: score.fairPlay, note: fairNote },
      defense: projection
        ? {
          enabled: false,
          basis: defense.basis,
          average: null,
          modifier: 0,
          note: "Il modificatore difesa non entra nella proiezione. Resta nel calcolo ufficiale.",
          rows: [],
        }
        : {
          enabled: defense.enabled,
          basis: defense.basis,
          average: defense.average == null ? null : round2(defense.average),
          modifier: round2(defense.modifier),
          note: defense.reason,
          rows: defenseRows,
        },
      reserve: {
        unfilled: played.unfilledHoles,
        shortfall,
        unit: emptyUnit,
        points: score.reservePoints,
        note: reserveNote,
      },
    },
    sum: {
      playersPoints: score.playersPoints,
      captain: score.captainModifier,
      fairPlay: score.fairPlay,
      defense: score.defenseModifier,
      reserve: score.reservePoints,
      total: score.total,
      storedTotal,
      delta,
    },
    result: {
      ranking: input.ranking,
      goalConversion: {
        applied: bands.length > 0,
        note: bands.length > 0
          ? "Lo scontro confronta i gol ricavati dalle soglie della lega: 3 a chi ne ha di più, 1 a testa se sono pari, 3 al riposo."
          : input.ranking === "head_to_head"
            ? "Lo scontro confronta i fantapunti: 3 a chi ne ha di più, 1 a testa se sono pari, 3 al riposo."
            : "Questa lega somma i fantapunti.",
      },
      fixture,
    },
  };
}

function fixtureFor(
  fantasyTeamId: string,
  teamName: string,
  weekNumber: number,
  ranking: LeagueRules["ranking"],
  totals: Totals[],
  total: number,
  goalBands: readonly GoalBand[] = [],
): ScoreAudit["result"]["fixture"] {
  if (ranking === "sum") {
    return {
      kind: "sum",
      opponentId: null,
      opponentName: null,
      opponentTotal: null,
      points: null,
      note: `${teamName} porta ${total} fantapunti in classifica. Il punteggio di giornata è questa somma.`,
    };
  }
  const { pairs, bye } = headToHeadPairings(totals.map((item) => item.fantasyTeamId), weekNumber);
  if (bye === fantasyTeamId) {
    return {
      kind: "bye",
      opponentId: null,
      opponentName: null,
      opponentTotal: null,
      points: 3,
      note: `${teamName} è a riposo in questa giornata: 3 punti, senza avversario.`,
    };
  }
  const pair = pairs.find((item) => item.home === fantasyTeamId || item.away === fantasyTeamId);
  if (!pair) {
    return {
      kind: "match",
      opponentId: null,
      opponentName: null,
      opponentTotal: null,
      points: null,
      note: "La squadra non entra nel tabellone di questa giornata.",
    };
  }
  const opponentId = pair.home === fantasyTeamId ? pair.away : pair.home;
  const opponent = totals.find((item) => item.fantasyTeamId === opponentId);
  const opponentTotal = opponent?.total ?? 0;
  const opponentName = opponent?.teamName ?? "Avversario";
  const mine = goalBands.length > 0 ? fantapuntiToGoals(total, goalBands) : total;
  const theirs = goalBands.length > 0 ? fantapuntiToGoals(opponentTotal, goalBands) : opponentTotal;
  const points = mine === theirs ? 1 : mine > theirs ? 3 : 0;
  const verdict = points === 1 ? "pareggio" : points === 3 ? "vittoria" : "sconfitta";
  const scoreText = goalBands.length > 0
    ? `${teamName} ${total} fantapunti (${mine} gol) contro ${opponentName} ${opponentTotal} fantapunti (${theirs} gol)`
    : `${teamName} ${total} contro ${opponentName} ${opponentTotal}`;
  return {
    kind: "match",
    opponentId,
    opponentName,
    opponentTotal,
    points,
    note: `${scoreText}: ${verdict}, ${points} punti.`,
  };
}
