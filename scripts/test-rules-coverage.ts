import { parseFantacalcioIndisponibili } from "@/lib/availability-providers/fantacalcio";
import { scoreLineup, type PlayerStat, type RulesetDefinition } from "@/lib/engine/calculator";
import { compactFromAudit, eventsFromAudit, eventsFromLines } from "@/lib/lineups/compact-sheet";
import { eventLines, explainScore, type AuditPlayer } from "@/lib/engine/score-audit";
import {
  availabilitySummaryKind,
  availabilityWriteKind,
  kickoffAlertKind,
  unmatchedAlertKind,
  voteAlertKind,
} from "@/lib/server/telegram-decisions";
import type { PlayerRole } from "@/lib/types";

type Case = { name: string; pass: boolean; detail: string };

const RULES: RulesetDefinition = {
  lineup_size: 11,
  double_captain_malus: true,
  empty_slot_points: 0,
  captain_modifier: [
    { max_exclusive: 6, points: -0.5 },
    { eq: 6, points: 0.5 },
    { eq: 6.5, points: 1 },
    { eq: 7, points: 1.5 },
    { min_inclusive: 7.5, points: 2 },
  ],
  fair_play: { points: 2.5, cards: ["yellow_card"] },
  defense_modifier: {
    enabled: true,
    basis: "voto",
    min_rated_defenders: 4,
    best_defenders: 3,
    bands: [{ min: 6, points: 1 }, { min: 6.5, points: 3 }],
  },
  bonus_malus: {
    yellow_card: -0.5,
    red_card: -1,
    goal: 3,
    assist: 1,
    penalty_missed: -3,
    penalty_saved: 3,
    own_goal: -2,
    goal_conceded: -1,
  },
  clean_sheet: { enabled: true, points: 1 },
  postponement: "political_six",
};

function card(club: string, injured: string[], suspended: string[], doubts: string[]) {
  const list = (title: string, names: string[]) => {
    const items = names.length
      ? names.map((name) => `<li><strong class="item-name">${name}</strong><div class="item-description">nota</div></li>`).join("")
      : `<li><div class="empty-list-message">Nessuno</div></li>`;
    return `<h3>${title}</h3><ul class="unstyled">${items}</ul>`;
  };
  return `<div id="team-1" class="card team-card"><span class="team-name">${club}</span>${list("Infortunati", injured)}${list("Squalificati", suspended)}${list("Diffidati", doubts)}</div>`;
}

function page(cards: string[]) {
  return cards.join("");
}

function clubs(count: number, first?: string) {
  const names = ["Bologna", "Milan", "Inter", "Juventus", "Roma", "Lazio", "Napoli", "Fiorentina", "Atalanta", "Torino", "Genoa", "Cagliari", "Lecce", "Parma", "Como", "Udinese", "Sassuolo", "Verona", "Venezia", "Cremonese"];
  return Array.from({ length: count }, (_, index) => (index === 0 && first ? first : card(names[index] ?? `Club ${index}`, [], [], [])));
}

function row(id: string, role: PlayerRole, extra: Partial<PlayerStat> = {}): PlayerStat {
  return {
    playerId: id,
    role,
    voto: extra.voto === undefined ? 6 : extra.voto,
    goals: extra.goals ?? 0,
    assists: extra.assists ?? 0,
    yellowCards: extra.yellowCards ?? 0,
    redCards: extra.redCards ?? 0,
    penaltiesScored: extra.penaltiesScored ?? 0,
    penaltiesMissed: extra.penaltiesMissed ?? 0,
    penaltiesSaved: extra.penaltiesSaved ?? 0,
    ownGoals: extra.ownGoals ?? 0,
    goalsConceded: extra.goalsConceded ?? 0,
    postponed: extra.postponed,
  };
}

const SHAPE: [string, PlayerRole][] = [
  ["gk", "GK"],
  ["d1", "DEF"],
  ["d2", "DEF"],
  ["d3", "DEF"],
  ["d4", "DEF"],
  ["m1", "MID"],
  ["m2", "MID"],
  ["m3", "MID"],
  ["m4", "MID"],
  ["f1", "FWD"],
  ["f2", "FWD"],
];

function score(
  overrides: Record<string, Partial<PlayerStat>> = {},
  captain = "m1",
  vice = "m2",
  rules: RulesetDefinition = RULES,
  holeIds?: ReadonlySet<string>,
) {
  const stats = new Map(SHAPE.map(([id, role]) => [id, row(id, role, overrides[id] ?? {})]));
  const slots = SHAPE.map(([id, role]) => ({
    playerId: id,
    role,
    isCaptain: id === captain,
    isVice: id === vice,
  }));
  return scoreLineup("rosa", slots, stats, rules, holeIds);
}

function player(result: ReturnType<typeof score>, id: string) {
  return result.players.find((item) => item.playerId === id);
}

function audit(input: Partial<AuditPlayer> & Pick<AuditPlayer, "playerId" | "role" | "slotKind" | "slotOrder" | "source">): AuditPlayer {
  return {
    name: input.playerId,
    baseVote: input.baseVote ?? 6,
    lines: input.lines ?? [],
    malusFactor: 1,
    fantavoto: input.fantavoto ?? input.baseVote ?? 6,
    captain: false,
    vice: false,
    replacedId: null,
    replacedName: null,
    ...input,
  };
}

export function runRulesCoverage() {
  const cases: Case[] = [];
  const add = (name: string, pass: boolean, detail: string) => cases.push({ name, pass, detail });

  const parsed = parseFantacalcioIndisponibili(page(clubs(18, card("Bologna", ["Miranda", "Miranda J."], ["Orsolini"], ["Veiga"]))));
  add(
    "Il parser tiene infortunati e squalificati",
    parsed.some((item) => item.name === "Miranda" && item.club === "Bologna" && item.status === "injured")
      && parsed.some((item) => item.name === "Orsolini" && item.status === "suspended"),
    parsed.map((item) => `${item.name}:${item.status}`).join(", "),
  );
  add(
    "I diffidati non entrano nell'elenco",
    !parsed.some((item) => item.name === "Veiga" || item.status === "doubt"),
    parsed.map((item) => item.name).join(", "),
  );
  add(
    "L'iniziale finale non diventa un altro calciatore",
    parsed.filter((item) => item.name === "Miranda").length === 2,
    String(parsed.filter((item) => item.name === "Miranda").length),
  );

  const empty = parseFantacalcioIndisponibili(page(clubs(18, card("Bologna", [], [], ["Veiga"]))));
  add("Nessuno non è un calciatore e i diffidati restano fuori", empty.length === 0, String(empty.length));

  const accented = parseFantacalcioIndisponibili(page(clubs(18, card("Sassuolo", ["Kon&egrave;"], [], []))));
  add("Le entità HTML del nome restano leggibili", accented.some((item) => item.name === "Konè" && item.status === "injured"), accented.map((item) => item.name).join(", "));

  let few = "";
  try {
    parseFantacalcioIndisponibili(page(clubs(10)));
    few = "non ha lanciato";
  } catch (error) {
    few = error instanceof Error ? error.message : "errore";
  }
  add("Una pagina senza le 18 squadre non aggiorna", few.includes("Nessun aggiornamento"), few);

  let broken = "";
  try {
    const bad = clubs(18);
    bad[3] = `<div id="team-1" class="card team-card"><span class="team-name">Roma</span><h3>Infortunati</h3><ul class="unstyled"></ul></div>`;
    parseFantacalcioIndisponibili(page(bad));
    broken = "non ha lanciato";
  } catch (error) {
    broken = error instanceof Error ? error.message : "errore";
  }
  add("Senza la sezione squalificati non aggiorna", broken.includes("Nessun aggiornamento"), broken);

  add("Zero variazioni di indisponibili non producono messaggio", availabilityWriteKind(0) === "none", availabilityWriteKind(0));
  add("Una variazione reale produce il riepilogo scritture", availabilityWriteKind(1) === "writes", availabilityWriteKind(1));
  add("Zero non abbinati non producono messaggio", unmatchedAlertKind(0) === "none", unmatchedAlertKind(0));
  add("I non abbinati restano un messaggio separato", unmatchedAlertKind(12) === "unmatched", unmatchedAlertKind(12));
  add(
    "Scritture e non abbinati si decidono insieme, senza fondersi",
    availabilityWriteKind(2) === "writes" && unmatchedAlertKind(3) === "unmatched",
    `${availabilityWriteKind(2)}+${unmatchedAlertKind(3)}`,
  );

  const voteBase = { jobType: "votes", recordsWritten: 4, force: false, morningClosing: false, playedDayStillOpen: false };
  add("Un errore sui voti avvisa anche con l'interruttore spento", voteAlertKind({ ...voteBase, status: "error", changed: 0, successEnabled: false }) === "error", "error");
  add(
    "I voti variati avvisano solo con l'interruttore acceso",
    voteAlertKind({ ...voteBase, status: "success", changed: 3, successEnabled: true }) === "success"
      && voteAlertKind({ ...voteBase, status: "success", changed: 3, successEnabled: false }) === "none",
    "success/none",
  );
  add(
    "La chiusura di giornata usa lo stesso riepilogo dei voti",
    voteAlertKind({ status: "success", jobType: "votes", recordsWritten: 1, force: false, changed: 1, successEnabled: true, morningClosing: false, playedDayStillOpen: false }) === "success"
      && voteAlertKind({ status: "success", jobType: "votes", recordsWritten: 1, force: false, changed: 1, successEnabled: false, morningClosing: true, playedDayStillOpen: true }) === "none",
    "chiusura",
  );
  add(
    "La finestra mattutina vuota avvisa solo se la giornata è ancora aperta",
    voteAlertKind({ status: "success", jobType: "votes", recordsWritten: 0, force: false, changed: 0, successEnabled: false, morningClosing: true, playedDayStillOpen: true }) === "morning-empty"
      && voteAlertKind({ status: "success", jobType: "votes", recordsWritten: 0, force: false, changed: 0, successEnabled: true, morningClosing: false, playedDayStillOpen: true }) === "none",
    "mattina",
  );
  add("Un giro saltato non manda messaggi", voteAlertKind({ ...voteBase, status: "skipped", changed: null, successEnabled: true }) === "none", "skipped");

  add("Un errore sugli orari avvisa anche con l'interruttore spento", kickoffAlertKind({ status: "error", changed: 0, successEnabled: false }) === "error", "error");
  add("Orari invariati non producono messaggio", kickoffAlertKind({ status: "success", changed: 0, successEnabled: true }) === "none", "none");
  add(
    "Un cambio orario avvisa solo con l'interruttore acceso",
    kickoffAlertKind({ status: "success", changed: 2, successEnabled: true }) === "success"
      && kickoffAlertKind({ status: "success", changed: 2, successEnabled: false }) === "none",
    "orari",
  );
  add(
    "Il riepilogo generico degli indisponibili resta legato all'interruttore",
    availabilitySummaryKind({ status: "success", changed: 4, successEnabled: true }) === "success"
      && availabilitySummaryKind({ status: "success", changed: 4, successEnabled: false }) === "none"
      && availabilitySummaryKind({ status: "error", changed: 0, successEnabled: false }) === "error",
    "riepilogo",
  );

  const base = score();
  add(
    "Undici 6 tengono fair play, fascia capitano e modificatore difesa",
    base.playersPoints === 67 && base.captainModifier === 0.5 && base.fairPlay === 2.5 && base.defenseModifier === 1 && base.total === 71 && player(base, "gk")?.bonusPoints === 1,
    `${base.playersPoints} cap ${base.captainModifier} fp ${base.fairPlay} def ${base.defenseModifier} tot ${base.total}`,
  );

  const poker = score({ f2: { voto: 6, goals: 4, assists: 1 } });
  const pokerRow = player(poker, "f2");
  add(
    "Quattro gol e un assist restano sullo stesso fantavoto",
    pokerRow?.bonusPoints === 13 && pokerRow.fantavoto === 19 && pokerRow.playerPoints === 19,
    `bonus ${pokerRow?.bonusPoints} fanta ${pokerRow?.fantavoto}`,
  );

  const captainCard = score({ m1: { voto: 6, yellowCards: 1 } });
  const captainRow = player(captainCard, "m1");
  add(
    "L'ammonizione del capitano vale doppia e spegne il fair play",
    captainRow?.malusFactor === 2 && captainRow.playerPoints === 5 && captainCard.fairPlay === 0 && captainCard.captainModifier === 0.5,
    `factor ${captainRow?.malusFactor} punti ${captainRow?.playerPoints} fp ${captainCard.fairPlay}`,
  );

  const shortDefense = score({ d4: { voto: null } });
  add(
    "Un difensore senza voto spegne il modificatore se non si arriva a quattro",
    shortDefense.defenseModifier === 0 && shortDefense.defenseAverage === null && player(shortDefense, "d4")?.playerPoints == null,
    `def ${shortDefense.defenseModifier} media ${shortDefense.defenseAverage}`,
  );

  const silentGoals = score({ f1: { voto: null, goals: 3 } });
  add(
    "I gol di un S.V. non entrano nel totale",
    player(silentGoals, "f1") == null && silentGoals.playersPoints === 61 && silentGoals.total === 65,
    `punti ${silentGoals.playersPoints} tot ${silentGoals.total} f1 ${player(silentGoals, "f1")?.playerPoints}`,
  );

  const vice = score({ m1: { voto: null }, m2: { voto: 7 } });
  add(
    "Se il capitano è S.V. la fascia passa al vice",
    vice.captainPlayerId === "m2" && vice.captainModifier === 1.5 && player(vice, "m2")?.isEffectiveCaptain === true,
    `${vice.captainPlayerId} fascia ${vice.captainModifier}`,
  );

  const conceded = score({ gk: { voto: 6, goalsConceded: 5 } });
  const keeper = player(conceded, "gk");
  add(
    "Cinque gol subiti restano un malus compatto, senza imbattibilità",
    keeper?.malusPoints === -5 && keeper.bonusPoints === 0 && keeper.fantavoto === 1,
    `malus ${keeper?.malusPoints} bonus ${keeper?.bonusPoints} fanta ${keeper?.fantavoto}`,
  );

  const clean = score({ gk: { voto: 6, goalsConceded: 0 } });
  add("Il portiere imbattuto prende il bonus di porta inviolata", player(clean, "gk")?.bonusPoints === 1 && player(clean, "gk")?.fantavoto === 7, `bonus ${player(clean, "gk")?.bonusPoints}`);

  const political = score({ f1: { voto: null, postponed: true, goals: 2, redCards: 1 } }, "m1", "m2", RULES, new Set());
  add(
    "Il 6 politico ignora gol e cartellini caricati sul tabellino",
    player(political, "f1")?.voto === 6 && player(political, "f1")?.bonusPoints === 0 && player(political, "f1")?.malusPoints === 0 && player(political, "f1")?.playerPoints === 6,
    `voto ${player(political, "f1")?.voto} bonus ${player(political, "f1")?.bonusPoints} malus ${player(political, "f1")?.malusPoints}`,
  );

  const stacked = score({ f2: { voto: 6, ownGoals: 1, penaltiesMissed: 1 } });
  add(
    "Autogol e rigore sbagliato si sommano sullo stesso giocatore",
    player(stacked, "f2")?.malusPoints === -5 && player(stacked, "f2")?.fantavoto === 1,
    `malus ${player(stacked, "f2")?.malusPoints} fanta ${player(stacked, "f2")?.fantavoto}`,
  );

  const marks = eventsFromAudit(audit({
    playerId: "f2",
    role: "FWD",
    slotKind: "starter",
    slotOrder: 10,
    source: "starter",
    lines: [
      { label: "Gol", count: 4, unit: 3, points: 12 },
      { label: "Assist", count: 1, unit: 1, points: 1 },
      { label: "Ammonizione", count: 2, unit: -0.5, points: -1 },
    ],
  }));
  add(
    "Gli eventi multipli restano un segno con il conteggio",
    marks.length === 3 && marks[0]?.kind === "goal" && marks[0].count === 4 && marks[2]?.kind === "yellow" && marks[2].count === 2,
    marks.map((item) => `${item.kind}:${item.count}`).join(", "),
  );

  const sheet = compactFromAudit([
    audit({ playerId: "fwd", role: "FWD", slotKind: "starter", slotOrder: 1, source: "starter" }),
    audit({ playerId: "gk", role: "GK", slotKind: "starter", slotOrder: 8, source: "starter" }),
    audit({ playerId: "late", role: "FWD", slotKind: "bench", slotOrder: 2, source: "bench", baseVote: 7 }),
    audit({ playerId: "early", role: "MID", slotKind: "bench", slotOrder: 1, source: "bench", baseVote: null }),
    audit({ playerId: "in", role: "MID", slotKind: "bench", slotOrder: 3, source: "substitute", baseVote: 6 }),
  ]);
  add(
    "I titolari si raggruppano per ruolo e la panchina resta nell'ordine schierato",
    sheet.starters.map((item) => item.id).join(",") === "gk,fwd"
      && sheet.bench.map((item) => item.id).join(",") === "early,late,in"
      && sheet.bench[2]?.entered === true
      && sheet.bench[0]?.entered === false
      && sheet.bench[0]?.played === false,
    `titolari ${sheet.starters.map((item) => item.id).join(",")} panchina ${sheet.bench.map((item) => `${item.id}:${item.entered}`).join(",")}`,
  );

  const liveMarks = (id: string, role: PlayerRole, extra: Partial<PlayerStat>, rules: RulesetDefinition = RULES) => (
    eventsFromLines(eventLines(row(id, role, extra), role, rules, false)).map((item) => `${item.kind}:${item.count}`).join()
  );
  add("In diretta il portiere imbattuto ha la sua icona", liveMarks("gk", "GK", { voto: 7 }) === "clean:1", liveMarks("gk", "GK", { voto: 7 }));
  add("Con l'imbattibilità spenta niente icona", liveMarks("gk", "GK", { voto: 7 }, { ...RULES, clean_sheet: { enabled: false, points: 1 } }) === "", "icona presente");
  add("Senza voto nessuna icona", liveMarks("gk", "GK", { voto: null }) === "", liveMarks("gk", "GK", { voto: null }));
  add("Rigore segnato, parato e gol subiti hanno icone distinte", liveMarks("f1", "FWD", { voto: 6, penaltiesScored: 1 }) === "penalty:1" && liveMarks("gk", "GK", { voto: 6, penaltiesSaved: 1, goalsConceded: 2 }) === "save:1,conceded:2", `${liveMarks("f1", "FWD", { voto: 6, penaltiesScored: 1 })} / ${liveMarks("gk", "GK", { voto: 6, penaltiesSaved: 1, goalsConceded: 2 })}`);

  const marksOf = (captainVote: number | null, mode: "official" | "provisional") => {
    const stats = new Map(SHAPE.map(([id, role]) => [id, row(id, role, id === "m1" ? { voto: captainVote } : {})]));
    const explained = explainScore({
      fantasyTeamId: "rosa",
      teamName: "Rosa",
      gameweekNumber: 13,
      slots: SHAPE.map(([id, role]) => ({ playerId: id, role, isCaptain: id === "m1", isVice: id === "m2" })),
      stats,
      definition: RULES,
      names: new Map(),
      mode,
      matchFinished: new Set(),
      ranking: "sum",
      totals: [],
      storedTotal: null,
    });
    const shown = compactFromAudit(explained.players);
    return [...shown.starters, ...shown.bench]
      .flatMap((item) => [item.captain ? `C:${item.id}` : "", item.vice ? `V:${item.id}` : ""])
      .filter(Boolean)
      .sort()
      .join(",");
  };
  add("Capitano e vice hanno ognuno il suo segno", marksOf(6, "official") === "C:m1,V:m2", marksOf(6, "official"));
  add("Il vice che fa da capitano mostra solo la C", marksOf(null, "official") === "C:m2", marksOf(null, "official"));
  add("La proiezione non assegna né capitano né vice", marksOf(6, "provisional") === "", marksOf(6, "provisional"));

  return {
    passed: cases.filter((item) => item.pass).length,
    total: cases.length,
    failures: cases.filter((item) => !item.pass).map((item) => `FAIL ${item.name}: ${item.detail}`),
  };
}
