// Formazione d'ufficio, rigori, colonne Excel, voti provvisori e schermate senza fonte.
// Solo dati inventati: nessun database e nessuna rete.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { fantacalcioVotesAdapter } from "../lib/adapters/excel/fantacalcio-votes";
import {
  filedPlayerScore,
  projectLiveScore,
  scoreLineup,
  type LineupSlotInput,
  type PlayerStat,
  type RulesetDefinition,
} from "../lib/engine/calculator";
import { explainScore } from "../lib/engine/score-audit";
import { carryLineup, formationIssue, type CarriedLineup } from "../lib/formations";
import { applyLeagueRules, DEFAULT_LEAGUE_RULES } from "../lib/league-rules";
import { mergeSnapshot, readSnapshot, withProvisionalVotes } from "../lib/server/provisional-votes";
import type { PlayerRole } from "../lib/types";

type Player = { id: string; role: PlayerRole };

function squad(shape: Record<PlayerRole, number>) {
  return (Object.keys(shape) as PlayerRole[]).flatMap((role) => (
    Array.from({ length: shape[role] }, (_, index) => ({ id: `${role}${index + 1}`, role }))
  ));
}

const ROSTER = squad({ GK: 2, DEF: 6, MID: 7, FWD: 5 });
const STARTERS = ["GK1", "DEF1", "DEF2", "DEF3", "DEF4", "MID1", "MID2", "MID3", "FWD1", "FWD2", "FWD3"];
const BENCH = ["GK2", "FWD4", "DEF5", "MID4", "FWD5", "DEF6", "MID5", "MID6", "MID7"];
const PREVIOUS: CarriedLineup = { playerIds: STARTERS, benchIds: BENCH, captainId: "FWD1", viceId: "MID1" };

function swap(roster: Player[], out: string, incoming: Player) {
  return [...roster.filter((player) => player.id !== out), incoming];
}

/** Tutto ciò che deve essere vero per qualunque formazione d'ufficio. */
function broken(roster: Player[], pick: CarriedLineup | null) {
  if (!pick) return "nessuna formazione";
  const known = new Set(roster.map((player) => player.id));
  const all = [...pick.playerIds, ...pick.benchIds];
  if (all.some((id) => !known.has(id))) return "c'è chi non è in rosa";
  if (new Set(all).size !== all.length) return "calciatore ripetuto";
  if (all.length !== roster.length) return `schierati ${all.length} di ${roster.length}`;
  const issue = formationIssue(roster, pick.playerIds);
  if (issue) return issue;
  if (!pick.captainId || !pick.playerIds.includes(pick.captainId)) return "capitano non titolare";
  if (pick.playerIds.length > 1 && (!pick.viceId || pick.viceId === pick.captainId || !pick.playerIds.includes(pick.viceId))) return "vice non valido";
  return null;
}

/** Numeri casuali ripetibili. */
function dice(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (state * 48271) % 2147483647;
    return state % limit;
  };
}

const SEASON: RulesetDefinition = {
  lineup_size: 11,
  empty_slot_points: 2.5,
  // Come il regolamento salvato nel database: il rigore segnato non è elencato.
  bonus_malus: { goal: 3, assist: 1, yellow_card: -0.5, red_card: -1, own_goal: -2, goal_conceded: -1, penalty_saved: 3, penalty_missed: -3 },
  captain_modifier: [{ min_inclusive: 0, points: 0 }],
};

function line(id: string, role: PlayerRole, extra: Partial<PlayerStat> = {}): PlayerStat {
  return { playerId: id, role, voto: 6, ...extra };
}

function one(stat: PlayerStat, definition: RulesetDefinition = SEASON, captain = false) {
  const slots: LineupSlotInput[] = [{ playerId: stat.playerId, role: stat.role, isCaptain: captain, isVice: false }];
  return scoreLineup("squadra", slots, new Map([[stat.playerId, stat]]), definition).players[0]?.playerPoints;
}

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full.replace(/\\/g, "/")] : [];
  });
}

export async function runLineupAndPointsChecks() {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };

  // --- Formazione d'ufficio
  const same = carryLineup(ROSTER, PREVIOUS);
  check("Rosa invariata: formazione identica", JSON.stringify(same) === JSON.stringify(PREVIOUS), JSON.stringify(same));

  const soldCaptain = swap(ROSTER, "FWD1", { id: "NUOVO", role: "FWD" });
  const heir = carryLineup(soldCaptain, PREVIOUS, new Map([["FWD1", "FWD"]]));
  check("Il ceduto esce", Boolean(heir) && ![...heir!.playerIds, ...heir!.benchIds].includes("FWD1"));
  check("Il nuovo acquisto prende il suo posto", heir?.playerIds[8] === "NUOVO", JSON.stringify(heir?.playerIds));
  check("Capitano ceduto: fascia al vice, nuovo vice", heir?.captainId === "MID1" && heir.viceId !== "MID1" && broken(soldCaptain, heir) === null, String(broken(soldCaptain, heir)));

  const otherRole = swap(ROSTER, "FWD2", { id: "NUOVO", role: "MID" });
  const shifted = carryLineup(otherRole, PREVIOUS, new Map([["FWD2", "FWD"]]));
  check("Nuovo acquisto di altro ruolo: il posto va al pari ruolo in panchina", shifted?.playerIds[9] === "FWD4" && shifted.benchIds.includes("NUOVO") && broken(otherRole, shifted) === null, JSON.stringify(shifted?.playerIds));

  const benchSale = swap(ROSTER, "DEF5", { id: "NUOVO", role: "DEF" });
  const benched = carryLineup(benchSale, PREVIOUS, new Map([["DEF5", "DEF"]]));
  check("Ceduto dalla panchina: il nuovo ne prende il numero", benched?.benchIds[2] === "NUOVO" && benched.playerIds.join() === STARTERS.join(), JSON.stringify(benched?.benchIds));

  const noStriker = squad({ GK: 2, DEF: 6, MID: 9, FWD: 3 }).filter((player) => player.id !== "FWD3");
  noStriker.push({ id: "NUOVO", role: "MID" });
  const reshaped = carryLineup(noStriker, PREVIOUS, new Map([["FWD3", "FWD"]]));
  check("Senza il terzo attaccante cambia modulo", broken(noStriker, reshaped) === null && reshaped?.playerIds.length === 11, String(broken(noStriker, reshaped)));

  const partial = carryLineup(ROSTER, { playerIds: STARTERS.slice(0, 7), benchIds: [...STARTERS.slice(7), ...BENCH], captainId: "GK1", viceId: "DEF1" });
  check("Formazione parziale: restano 7 titolari", partial?.playerIds.length === 7 && broken(ROSTER, partial) === null);

  const repainted = ROSTER.map((player) => (player.id === "MID1" ? { ...player, role: "FWD" as const } : player));
  const recast = carryLineup(repainted, PREVIOUS);
  check("Ruolo cambiato: nessun modulo non valido", broken(repainted, recast) === null, String(broken(repainted, recast)));
  check("Senza formazione precedente non inventa", carryLineup(ROSTER, { playerIds: [], benchIds: [], captainId: null, viceId: null }) === null);

  const roll = dice(20261127);
  let fuzz: string | null = null;
  for (let run = 0; run < 3000 && !fuzz; run += 1) {
    const keepers = 2 + roll(2);
    const rest = 20 - keepers;
    const defenders = 3 + roll(7);
    const midfielders = Math.min(9, Math.max(3, rest - defenders - 3 - roll(5)));
    const forwards = rest - defenders - midfielders;
    if (forwards < 3 || forwards > 9) continue;
    const base = squad({ GK: keepers, DEF: defenders, MID: midfielders, FWD: forwards });
    const first = carryLineup(base, { playerIds: base.map((player) => player.id).sort(() => roll(3) - 1), benchIds: [], captainId: null, viceId: null });
    if (!first) continue;
    let current = base;
    const former = new Map<string, PlayerRole>();
    for (let change = 0, count = roll(6); change < count; change += 1) {
      const out = current[roll(current.length)];
      former.set(out.id, out.role);
      const role = out.role === "GK" ? "GK" : (["DEF", "MID", "FWD"] as const)[roll(3)];
      current = swap(current, out.id, { id: `N${run}-${change}`, role });
    }
    const next = carryLineup(current, first, former);
    const problem = broken(current, next);
    const full = ["DEF", "MID", "FWD"].every((role) => current.filter((player) => player.role === role).length >= 3);
    if (problem) fuzz = `giro ${run}: ${problem}`;
    else if (full && next!.playerIds.length !== first.playerIds.length) fuzz = `giro ${run}: titolari ${next!.playerIds.length} invece di ${first.playerIds.length}`;
  }
  check("3000 rose casuali: sempre valide", fuzz === null, fuzz ?? "");

  // --- Rigori: +3 segnato, +3 parato, −3 sbagliato, una volta sola
  check("Rigore segnato +3 col regolamento di stagione", one(line("a", "FWD", { penaltiesScored: 1 })) === 9);
  check("Gol su azione più rigore: due reti, 6 punti", one(line("a", "FWD", { goals: 1, penaltiesScored: 1 })) === 12);
  check("Rigore parato +3", one(line("p", "GK", { penaltiesSaved: 1 })) === 9);
  check("Rigore sbagliato −3", one(line("a", "FWD", { penaltiesMissed: 1 })) === 3);
  check("Capitano: il rigore segnato non raddoppia", one(line("a", "FWD", { penaltiesScored: 1 }), SEASON, true) === 9);
  const bare: RulesetDefinition = { lineup_size: 11, bonus_malus: {} };
  check("Valori dei rigori anche con regolamento vuoto", one(line("a", "FWD", { penaltiesScored: 1 }), bare) === 9);
  check("Pagella singola +3", filedPlayerScore(line("a", "FWD", { penaltiesScored: 1 }), "FWD", SEASON).fantavoto === 9);
  const slots: LineupSlotInput[] = [{ playerId: "a", role: "FWD", isCaptain: false, isVice: false }];
  const stats = new Map([["a", line("a", "FWD", { penaltiesScored: 1 })]]);
  check("Parziale provvisorio +3", projectLiveScore("s", "g", slots, stats, SEASON).provisionalTotal === 9 + 25);
  check("Regole di lega predefinite +3", one(line("a", "FWD", { penaltiesScored: 1 }), applyLeagueRules(SEASON, DEFAULT_LEAGUE_RULES)) === 9);
  const switchedOff = applyLeagueRules(SEASON, { ...DEFAULT_LEAGUE_RULES, bonusEnabled: { ...DEFAULT_LEAGUE_RULES.bonusEnabled, penalty_scored: false } });
  check("Lega che spegne la voce: resta spenta", one(line("a", "FWD", { penaltiesScored: 1 }), switchedOff) === 6);
  const audit = explainScore({
    fantasyTeamId: "s", teamName: "Squadra", gameweekNumber: 1, slots, stats, definition: SEASON,
    names: new Map([["a", "Rigorista"]]), mode: "official", matchFinished: new Set(["a"]), ranking: "sum",
    totals: [], storedTotal: null,
  });
  check("Dettaglio del punteggio: la riga del rigore vale 3", JSON.stringify(audit).includes("\"label\":\"Rigore segnato\",\"count\":1,\"unit\":3,\"points\":3"));

  // --- Excel: Rp parati, Rs sbagliati, Rf segnati
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Fantacalcio");
  const club = sheet.addRow(["Prova"]);
  sheet.mergeCells(club.number, 1, club.number, 13);
  sheet.addRow(["Cod.", "Ruolo", "Nome", "Voto", "Gf", "Gs", "Rp", "Rs", "Rf", "Au", "Amm", "Esp", "Ass"]);
  sheet.addRow([1, "P", "Portiere", 7, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
  sheet.addRow([2, "C", "Rigorista", 6.5, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  sheet.addRow([3, "A", "Sfortunato", 4.5, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  const parsed = await fantacalcioVotesAdapter.parse({ bytes: Buffer.from(await book.xlsx.writeBuffer()) });
  const [keeper, taker, misser] = parsed.votes;
  check("Excel Rp = rigore parato", keeper?.penaltiesSaved === 1 && keeper.penaltiesScored === 0);
  check("Excel Rf = rigore segnato", taker?.penaltiesScored === 1 && taker.penaltiesSaved === 0 && taker.goals === 0);
  check("Excel Rs = rigore sbagliato", misser?.penaltiesMissed === 1);

  // --- Voti provvisori
  const vote = (playerId: string, voto: number | null) => ({
    playerId, voto, goals: 0, assists: 0, yellowCards: 0, redCards: 0,
    penaltiesScored: 0, penaltiesMissed: 0, penaltiesSaved: 0, ownGoals: 0, goalsConceded: 0,
  });
  const official = new Map([["ufficiale", line("ufficiale", "MID", { voto: 7 })]]);
  const merged = withProvisionalVotes(
    official,
    [vote("ufficiale", 4), vote("chiusa", 5), vote("aperta", 6.5)],
    new Set(["chiusa"]),
    new Map([["aperta", "DEF"]]),
  );
  check("L'ufficiale vince sul provvisorio", merged.get("ufficiale")?.voto === 7);
  check("Partita finita: il provvisorio non entra", !merged.has("chiusa"));
  check("Partita aperta: si vede il provvisorio", merged.get("aperta")?.voto === 6.5 && merged.get("aperta")?.role === "DEF");
  const joined = mergeSnapshot([vote("a", 6), vote("b", 5)], [vote("a", 7), vote("b", null), vote("c", 6)]);
  check("Seconda lettura: aggiorna senza cancellare", joined.map((item) => `${item.playerId}:${item.voto}`).join() === "a:7,b:5,c:6");
  check("Lettura illeggibile: nessun voto", readSnapshot("non è json").length === 0 && readSnapshot("{}").length === 0);
  check("Lettura salvata e riletta", readSnapshot(JSON.stringify({ votes: joined }))[0]?.voto === 7);

  // --- Nessuna schermata contatta la fonte dei voti
  const files = ["app", "components", "lib"].flatMap(sources);
  const using = (text: string) => files.filter((file) => readFileSync(file, "utf8").includes(text)).sort();
  const fetchers = using("fetchFantacalcioMatchweek");
  check(
    "La pagina dei voti si legge solo dalle letture programmate",
    fetchers.join() === "lib/server/fantacalcio-live.ts,lib/server/sync-match-votes.ts",
    fetchers.join(),
  );
  const importers = using("@/lib/server/sync-match-votes").filter((file) => file.startsWith("app/") || file.startsWith("components/"));
  check(
    "Solo le sveglie automatiche importano la lettura",
    importers.every((file) => file.startsWith("app/api/cron/")),
    importers.join(),
  );

  return { total, passed: total - failures.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runLineupAndPointsChecks().then((result) => {
    console.log(`Formazioni e punti: ${result.passed}/${result.total}`);
    for (const failure of result.failures) console.log(`- ${failure}`);
    if (result.failures.length > 0) process.exit(1);
  });
}
