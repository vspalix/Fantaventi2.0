// Bonus cambiati a lega iniziata: «da ora» o per tutte le giornate.
// Finto Supabase in memoria e dati inventati: nessun database vero, nessuna rete.
import { FakeSupabase, type Tables } from "./fake-supabase";
import type { PlayerRole } from "../lib/types";

const SEASON = "season-1";
const OWNER = "user-A";
const LEAGUE = "league-1";
const DAY = 24 * 60 * 60 * 1000;

const SHAPE: [PlayerRole, number][] = [["GK", 1], ["DEF", 4], ["MID", 4], ["FWD", 2]];
const PLAYERS = SHAPE.flatMap(([role, count]) => Array.from({ length: count }, (_, index) => ({ id: `${role}${index + 1}`, role })));

/** Giornate 1 e 2 calcolate, 3 in corso, 4 ancora da schierare. In tutte la stessa formazione e gli stessi voti. */
function seed(): Tables {
  const weeks = [1, 2, 3, 4].map((number) => ({
    id: `gw-${number}`, season_id: SEASON, number,
    status: number < 3 ? "scored" : number === 3 ? "locked" : "scheduled",
    deadline_at: new Date(Date.now() + (number - 3.5) * 7 * DAY).toISOString(),
  }));
  return {
    rulesets: [{ id: "ruleset-1", definition: {
      lineup_size: 11,
      bonus_malus: { goal: 3, assist: 1, yellow_card: -0.5, red_card: -1, own_goal: -2, goal_conceded: -1, penalty_saved: 3, penalty_missed: -3 },
      captain_modifier: [{ min_inclusive: 0, points: 0 }],
    } }],
    seasons: [{ id: SEASON, ruleset_id: "ruleset-1", code: "2026" }],
    gameweeks: weeks,
    profiles: ["A", "B", "C"].map((team) => ({ id: `user-${team}`, display_name: team })),
    fantasy_teams: ["A", "B", "C"].map((team) => ({ id: `team-${team}`, season_id: SEASON, user_id: `user-${team}`, name: `Squadra ${team}`, is_sandbox: false })),
    private_leagues: [{
      id: LEAGUE, name: "Lega di prova", join_code: "AAAA1111", season_id: SEASON, owner_user_id: OWNER,
      start_matchday: 1, end_matchday: 38, competition_format: "classic", is_sandbox: false,
      settings: { defenseEnabled: false, captainEnabled: false, cleanSheetEnabled: false },
    }],
    private_league_members: ["A", "B", "C"].map((team) => ({ private_league_id: LEAGUE, fantasy_team_id: `team-${team}` })),
    league_delegates: [],
    players: PLAYERS.map((player) => ({ id: player.id, full_name: player.id })),
    player_registrations: PLAYERS.map((player) => ({
      player_id: player.id, season_id: SEASON, role: player.role, club_id: "club-x", effective_from_gameweek: 1, effective_to_gameweek: null,
    })),
    clubs: [{ id: "club-x", code: "XXX" }],
    roster_stints: [],
    lineups: weeks.map((week) => ({ id: `lineup-${week.number}`, fantasy_team_id: "team-A", gameweek_id: week.id, status: "locked", origin: "user" })),
    lineup_slots: weeks.flatMap((week) => PLAYERS.map((player, index) => ({
      lineup_id: `lineup-${week.number}`, player_id: player.id, is_captain: false, is_vice_captain: false, is_starter: true, slot_order: index + 1,
    }))),
    // Tutti 6, un gol e un assist: 66 di voti, più 3 e 1.
    player_gameweek_stats: weeks.flatMap((week) => PLAYERS.map((player) => ({
      id: `${week.id}-${player.id}`, gameweek_id: week.id, player_id: player.id, voto: 6,
      goals: player.id === "FWD1" ? 1 : 0, assists: player.id === "MID1" ? 1 : 0, yellow_cards: 0, red_cards: 0,
      penalties_scored: 0, penalties_missed: 0, penalties_saved: 0, own_goals: 0, goals_conceded: 0, postponed: false,
    }))),
    real_matches: [],
    team_gameweek_scores: [],
    vote_imports: [],
  };
}

export async function runRuleHistoryChecks() {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };
  const same = (value: unknown, expected: unknown) => JSON.stringify(value) === JSON.stringify(expected);

  const tables = seed();
  const fake = new FakeSupabase(tables);
  const url = await fake.start();
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";

  try {
    const { parseLeagueRules } = await import("../lib/league-rules");
    const { changedScoring, nextScoringHistory, parseScoringHistory, rulesAt, scoringHistoryLines } = await import("../lib/scoring-history");
    const { buildOfficialRegulation } = await import("../lib/rules/official-regulation");

    // --- Lo storico, senza database
    const base = parseLeagueRules({});
    const goal = (points: number, from = base) => ({ ...from, bonusMalus: { ...from.bonusMalus, goal: points } });
    const first = { ...goal(4), scoringHistory: nextScoringHistory(base, goal(4), "from-now", 5) };
    check("Da ora: le giornate prima tengono il valore di prima", rulesAt(first, 1).bonusMalus.goal === 3 && rulesAt(first, 4).bonusMalus.goal === 3);
    check("Da ora: dalla giornata scelta vale il nuovo", rulesAt(first, 5).bonusMalus.goal === 4 && rulesAt(first, 38).bonusMalus.goal === 4);
    const second = { ...goal(5, first), scoringHistory: nextScoringHistory(first, goal(5, first), "from-now", 8) };
    check("Due cambi: ogni periodo ha il suo valore", [4, 5, 7, 8].map((week) => rulesAt(second, week).bonusMalus.goal).join() === "3,4,4,5");
    const twice = { ...goal(6, first), scoringHistory: nextScoringHistory(first, goal(6, first), "from-now", 5) };
    check("Due cambi nella stessa giornata: il passato resta quello vero", rulesAt(twice, 4).bonusMalus.goal === 3 && rulesAt(twice, 5).bonusMalus.goal === 6);
    const back = { ...goal(3, second), scoringHistory: nextScoringHistory(second, goal(3, second), "from-now", 10) };
    check("Tornare indietro da ora non tocca il passato", [4, 5, 8, 9, 10].map((week) => rulesAt(back, week).bonusMalus.goal).join() === "3,4,5,5,3");
    check("Per tutte: la voce cambiata perde lo storico", nextScoringHistory(second, goal(7, second), "all", 10).length === 0);
    const clean = { ...second, cleanSheetEnabled: false };
    const mixed = nextScoringHistory(second, clean, "all", 10);
    check("Per tutte: le altre voci conservano il loro storico", same(mixed, second.scoringHistory), JSON.stringify(mixed));
    check("Lega non iniziata: nessuno storico", nextScoringHistory(base, goal(4), "from-now", 1).length === 0);
    check("Punti di una voce spenta: nessun cambio", changedScoring({ ...base, cleanSheetEnabled: false }, { ...base, cleanSheetEnabled: false, cleanSheetPoints: 3 }).length === 0);
    check("Regole non di punteggio: nessuna domanda", changedScoring(base, { ...base, visibility: "public", missedLineupPenalty: 5, goalBands: [] }).length === 0);
    const others = { ...base, captainMultiplier: 2 as const, defenseEnabled: false, bonusEnabled: { ...base.bonusEnabled, assist: false } };
    check("Capitano, difesa e voce spenta sono cambi di punteggio", changedScoring(base, others).join() === "assist,captain,defense");
    const past = { ...others, scoringHistory: nextScoringHistory(base, others, "from-now", 3) };
    const week2 = rulesAt(past, 2);
    check("Capitano, difesa e assist di prima nelle giornate passate", week2.captainMultiplier === 1 && week2.defenseEnabled && week2.bonusEnabled.assist);
    check("Lo storico salvato si rilegge uguale", same(parseLeagueRules(JSON.parse(JSON.stringify(second))).scoringHistory, second.scoringHistory));
    check("Righe di storico non valide scartate", parseScoringHistory([null, { key: "x", until: 1, enabled: true, points: 1 }, { key: "goal", until: 0, enabled: true, points: 1 }, { key: "goal", until: 2, points: 1 }]).length === 0);
    check("Storico spiegato a parole", same(scoringHistoryLines(second.scoringHistory), ["Gol: +3 fino alla giornata 4", "Gol: +4 dalla giornata 5 alla 7"]), JSON.stringify(scoringHistoryLines(second.scoringHistory)));
    check("Il regolamento dice i valori delle giornate passate", buildOfficialRegulation("Lega", second).includes("- Gol: +3 fino alla giornata 4") && !buildOfficialRegulation("Lega", base).includes("Nelle giornate precedenti, dove"));

    // --- Salvataggio dell'admin e calcolo
    const { updateLeague } = await import("../lib/server/leagues");
    const { fantasyPointsForLeague } = await import("../lib/server/league-scores");
    const { loadScoreAudit } = await import("../lib/server/score-audit");
    const weeks = [1, 2, 3, 4].map((number) => ({ id: `gw-${number}`, number }));
    const totals = async () => {
      const points = await fantasyPointsForLeague(LEAGUE, SEASON, ["team-A"], weeks);
      return weeks.map((week) => points.get(`team-A:${week.id}`)).join();
    };
    const stored = () => tables.private_leagues[0].settings as ReturnType<typeof parseLeagueRules>;
    const save = async (input: Parameters<typeof updateLeague>[2]) => {
      try {
        await updateLeague(OWNER, LEAGUE, input);
        return null;
      } catch (error) {
        return error as Error & { status?: number; scoringChoice?: { fromMatchday: number; changed: string[] } };
      }
    };

    const start = await totals();
    // Fair play compreso o no, le quattro giornate partono uguali.
    const one = Number(start.split(",")[0]);
    check("Partenza: quattro giornate uguali", start === [one, one, one, one].join(), start);

    const before = JSON.stringify(stored());
    const asked = await save({ rules: { bonusMalus: { ...base.bonusMalus, goal: 5 } } });
    check("Senza scelta non si salva", asked?.status === 409 && JSON.stringify(stored()) === before, asked?.message);
    check("La domanda dice cosa cambia e da quando", same(asked?.scoringChoice, { fromMatchday: 4, changed: ["Gol"] }), JSON.stringify(asked?.scoringChoice));

    const forged = [{ key: "assist" as const, until: 38, enabled: true, points: 50 }];
    const fromNow = await save({ rules: { bonusMalus: { ...base.bonusMalus, goal: 5 }, scoringHistory: forged }, scoringApply: "from-now" });
    check("Da ora: salvata", fromNow === null, fromNow?.message);
    check("Lo storico lo scrive solo il server", same(stored().scoringHistory, [{ key: "goal", until: 3, enabled: true, points: 3 }]), JSON.stringify(stored().scoringHistory));
    const split = await totals();
    check("Da ora: calcolate e in corso invariate, la prossima con il nuovo gol", split === [one, one, one, one + 2].join(), split);
    const audit = await loadScoreAudit(OWNER, LEAGUE, "gw-1", "team-A");
    check("Il dettaglio di una giornata passata usa il valore di allora", audit.sum.total === one, `${audit.sum.total} / ${one}`);

    const all = await save({ rules: { bonusMalus: { ...stored().bonusMalus, goal: 4 } }, scoringApply: "all" });
    check("Per tutte: salvata e ricalcolata", all === null && (await totals()) === [one + 1, one + 1, one + 1, one + 1].join(), all?.message ?? (await totals()));
    check("Per tutte: storico del gol cancellato", stored().scoringHistory.length === 0);

    await save({ rules: { bonusEnabled: { ...stored().bonusEnabled, assist: false } }, scoringApply: "from-now" });
    check("Voce spenta da ora: pesa solo sulla prossima", (await totals()) === [one + 1, one + 1, one + 1, one].join(), await totals());
    const structural = await save({ rules: { visibility: "public", missedLineupPenalty: 3 } });
    check("Le altre regole si salvano senza domande e tengono lo storico", structural === null && stored().visibility === "public" && stored().scoringHistory.length === 1, structural?.message);
    const renamed = await save({ name: "Nome nuovo" });
    check("Cambiare il nome non tocca le regole", renamed === null && stored().scoringHistory.length === 1, renamed?.message);

    const crowded = await save({ rules: { enrollment: "closed", maxMembers: 2 } });
    check("Mai meno posti delle squadre iscritte", crowded === null ? false : crowded.status === 409, crowded?.message ?? "salvata");

    // --- Numero chiuso: chi è già dentro conserva la media, e si entra solo prima dell'inizio
    const { loadLiveCenter } = await import("../lib/server/live-center");
    const { getLeagueDetail, joinLeague } = await import("../lib/server/leagues");
    // La squadra C schiera per la prima volta alla giornata 3: è entrata in corsa.
    tables.lineups.push({ id: "lineup-late", fantasy_team_id: "team-C", gameweek_id: "gw-3", status: "locked", origin: "user" });
    tables.lineup_slots.push(...tables.lineup_slots.filter((slot) => slot.lineup_id === "lineup-3").map((slot) => ({ ...slot, lineup_id: "lineup-late" })));
    const lateTotal = async () => {
      const detail = await getLeagueDetail(OWNER, LEAGUE);
      const league = { ...detail, rules: stored() };
      const center = await loadLiveCenter(league, OWNER);
      return center.table.find((row) => row.teamName === "Squadra C")?.points ?? null;
    };
    const open = await lateTotal();
    check("Aperta: chi entra in corsa riceve la media", Number(open) > 0, String(open));

    const forgedKept = await save({ rules: { visibility: "private", lateEntryKept: ["team-X"] } });
    check("Le medie conservate le scrive solo il server", forgedKept === null && stored().lateEntryKept.length === 0, JSON.stringify(stored().lateEntryKept));
    const closing = await save({ rules: { enrollment: "closed", maxMembers: 8 } });
    check("Chiusura a lega iniziata: salvata senza domande", closing === null, closing?.message);
    check("Chi è già dentro è segnato", same([...stored().lateEntryKept].sort(), ["team-A", "team-B", "team-C"]), JSON.stringify(stored().lateEntryKept));
    const kept = await lateTotal();
    check("Chiusa dopo: la media resta uguale", kept === open, `${open} / ${kept}`);
    const again = await save({ rules: { maxMembers: 9 } });
    check("Salvare ancora non perde le medie", again === null && stored().lateEntryKept.length === 3, again?.message);
    check("Il regolamento lo spiega", buildOfficialRegulation("Lega", stored()).includes("Chi era già dentro conserva la media"));
    tables.private_leagues[0].settings = { ...stored(), lateEntryKept: [] };
    check("Lega nata chiusa: nessuna media di ingresso", (await lateTotal()) !== open);

    const newcomer = "user-N";
    const join = async () => {
      try {
        await joinLeague(newcomer, "nuovo@esempio.test", "AAAA1111");
        return null;
      } catch (error) {
        return error as Error & { status?: number };
      }
    };
    const membersBefore = tables.private_league_members.length;
    const refused = await join();
    check("Chiusa e già iniziata: non si entra", refused?.status === 409 && /già iniziata/.test(refused.message) && tables.private_league_members.length === membersBefore, refused?.message ?? "entrato");
    tables.private_leagues[0].start_matchday = 4;
    tables.private_leagues[0].settings = { ...stored(), maxMembers: 3 };
    const full = await join();
    check("Chiusa senza posti: non si entra", /slot occupati/.test(full?.message ?? ""), full?.message ?? "entrato");
    tables.private_leagues[0].settings = { ...stored(), maxMembers: 8 };
    const welcomed = await join();
    check("Chiusa che parte più avanti, a campionato iniziato: si entra", welcomed === null && tables.private_league_members.length === membersBefore + 1, welcomed?.message);
    tables.private_league_members.pop();

    const early2 = await save({ rules: { enrollment: "open" } });
    const closeEarly = await save({ rules: { enrollment: "closed", maxMembers: 8, lateEntryKept: [] } });
    check("Chiusura prima dell'inizio: nessuna media da conservare in più", early2 === null && closeEarly === null && stored().lateEntryKept.length === 0, JSON.stringify(stored().lateEntryKept));

    // --- Partita rinviata: il dettaglio di squadra coincide con la classifica
    tables.player_registrations.find((row) => row.player_id === "FWD1")!.club_id = "club-z";
    tables.players.push({ id: "FWD3", full_name: "FWD3" });
    tables.player_registrations.push({ player_id: "FWD3", season_id: SEASON, role: "FWD", club_id: "club-x", effective_from_gameweek: 1, effective_to_gameweek: null });
    tables.lineup_slots.push({ lineup_id: "lineup-1", player_id: "FWD3", is_captain: false, is_vice_captain: false, is_starter: false, slot_order: 1 });
    tables.player_gameweek_stats.push({ ...tables.player_gameweek_stats.find((row) => row.gameweek_id === "gw-1" && row.player_id === "FWD2")!, id: "gw-1-FWD3", player_id: "FWD3", voto: 8 });
    tables.real_matches.push({ id: "held", gameweek_id: "gw-1", home_club_id: "club-z", away_club_id: "club-w", status: "scheduled", postponed: true, hold_status: "postponed" });
    for (const postponement of ["political_six", "wait_recovery"] as const) {
      const label = postponement === "political_six" ? "6 politico" : "Attesa del recupero";
      tables.private_leagues[0].settings = { ...stored(), postponement };
      const ranking = (await fantasyPointsForLeague(LEAGUE, SEASON, ["team-A"], [{ id: "gw-1", number: 1 }])).get("team-A:gw-1");
      const detail = await loadScoreAudit(OWNER, LEAGUE, "gw-1", "team-A");
      const heldPlayer = detail.players.find((player) => player.playerId === "FWD1");
      check(`${label}: dettaglio e classifica hanno lo stesso totale`, detail.sum.total === ranking, `${detail.sum.total} / ${ranking}`);
      check(`${label}: il calciatore rinviato resta in campo`, heldPlayer?.source === "starter" && heldPlayer.held && detail.substitutions.every((step) => !step.entrantId), JSON.stringify(heldPlayer));
      check(
        `${label}: voto e segno giusti`,
        postponement === "political_six"
          ? heldPlayer?.fantavoto === 6 && heldPlayer.lines.some((line) => line.label.startsWith("6 politico"))
          : heldPlayer?.baseVote === null && heldPlayer.lines.length === 0,
        JSON.stringify(heldPlayer),
      );
    }
    tables.real_matches.pop();

    tables.private_leagues[0].start_matchday = 4;
    const early = await save({ rules: { bonusMalus: { ...stored().bonusMalus, goal: 6 } } });
    check("Lega non ancora iniziata: nessuna domanda", early === null && stored().bonusMalus.goal === 6 && !stored().scoringHistory.some((item) => item.key === "goal"), early?.message);
  } finally {
    await fake.stop();
  }
  return { failures, total, passed: total - failures.length };
}

const direct = process.argv[1] && /test-rule-history\.ts$/.test(process.argv[1].replace(/\\/g, "/"));
if (direct) {
  runRuleHistoryChecks().then((result) => {
    console.log(`Bonus cambiati a lega iniziata: ${result.failures.length === 0 ? "PASSED" : "FAILED"} ${result.passed}/${result.total}`);
    for (const failure of result.failures) console.log(`- ${failure}`);
    process.exit(result.failures.length === 0 ? 0 : 1);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
