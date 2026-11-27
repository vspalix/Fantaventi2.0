// Formazione d'ufficio in diretta: chi non salva vede subito, dopo la chiusura, la formazione
// che il calcolo registrerà, con i punti parziali e le penalità della lega.
// Finto Supabase in memoria, voti provvisori finti e orologio finto: nessun database vero, nessuna rete.
import { FakeSupabase, type Row, type Tables } from "./fake-supabase";
import type { LeagueDetail, PlayerRole } from "../lib/types";

const SEASON = "season-1";
const GW1 = "gw-1";
const GW2 = "gw-2";
const DEADLINE = "2026-11-29T14:00:00.000Z";
const BEFORE = new Date("2026-11-29T12:00:00.000Z");
const AFTER = new Date("2026-11-29T16:00:00.000Z");
const PENALTY = 42.5;

const SHAPE: [PlayerRole, number][] = [["GK", 2], ["DEF", 6], ["MID", 7], ["FWD", 5]];

/** Venti calciatori per squadra; i nomi in ordine alfabetico al contrario per riconoscere l'ordine d'ufficio. */
function squad(team: string) {
  return SHAPE.flatMap(([role, count]) => Array.from({ length: count }, (_, index) => ({
    id: `${team}-${role}${index + 1}`,
    role,
    name: `${team} ${role} ${String.fromCharCode(90 - index)}`,
  })));
}

const TEAMS = ["A", "B", "C", "D", "E"];
const STARTERS = ["GK1", "DEF1", "DEF2", "DEF3", "DEF4", "MID1", "MID2", "MID3", "FWD1", "FWD2", "FWD3"];

function lineupRows(id: string, team: string, gameweekId: string, starters: string[], captain: string, vice: string, origin = "user") {
  const all = squad(team).map((player) => player.id);
  const fielded = starters.map((short) => `${team}-${short}`);
  const bench = all.filter((playerId) => !fielded.includes(playerId));
  const lineup = { id, fantasy_team_id: `team-${team}`, gameweek_id: gameweekId, status: "locked", origin, saved_at: "2026-11-20T10:00:00.000Z" };
  const slots = [
    ...fielded.map((playerId, index) => ({
      lineup_id: id, player_id: playerId, is_captain: playerId === `${team}-${captain}`, is_vice_captain: playerId === `${team}-${vice}`, is_starter: true, slot_order: index + 1,
    })),
    ...bench.map((playerId, index) => ({
      lineup_id: id, player_id: playerId, is_captain: false, is_vice_captain: false, is_starter: false, slot_order: index + 1,
    })),
  ];
  return { lineup, slots };
}

function seed(): Tables {
  const players: Row[] = [];
  const registrations: Row[] = [];
  const stints: Row[] = [];
  for (const team of TEAMS) {
    squad(team).forEach((player, index) => {
      players.push({ id: player.id, full_name: player.name });
      registrations.push({
        player_id: player.id, season_id: SEASON, role: player.role, club_id: index % 2 ? "club-y" : "club-x",
        effective_from_gameweek: 1, effective_to_gameweek: null,
      });
      // B ha ceduto il suo capitano dopo la giornata 1.
      const sold = player.id === "B-FWD1";
      stints.push({ fantasy_team_id: `team-${team}`, player_id: player.id, active_from_gameweek: 1, active_until_gameweek: sold ? 1 : null });
    });
  }
  players.push({ id: "B-NEW", full_name: "B nuovo attaccante" });
  registrations.push({ player_id: "B-NEW", season_id: SEASON, role: "FWD", club_id: "club-x", effective_from_gameweek: 1, effective_to_gameweek: null });
  stints.push({ fantasy_team_id: "team-B", player_id: "B-NEW", active_from_gameweek: 2, active_until_gameweek: null });

  const b1 = lineupRows("lineup-b1", "B", GW1, STARTERS, "FWD1", "MID1");
  const a1 = lineupRows("lineup-a1", "A", GW1, STARTERS, "FWD1", "MID1");
  const a2 = lineupRows("lineup-a2", "A", GW2, ["GK2", "DEF1", "DEF2", "DEF3", "MID1", "MID2", "MID3", "MID4", "FWD1", "FWD2", "FWD3"], "FWD2", "MID1");
  const e1 = lineupRows("lineup-e1", "E", GW1, STARTERS, "MID2", "DEF1");

  return {
    rulesets: [{ id: "ruleset-1", definition: {
      lineup_size: 11,
      bonus_malus: { goal: 3, assist: 1, yellow_card: -0.5, red_card: -1, own_goal: -2, goal_conceded: -1, penalty_saved: 3, penalty_missed: -3 },
      captain_modifier: [{ min_inclusive: 0, points: 0 }],
      // La proiezione live non applica gli effetti del capitano (per tutti, non solo d'ufficio):
      // spenti qui, diretta e calcolo finale devono coincidere al centesimo.
      double_captain_malus: false,
    } }],
    seasons: [{ id: SEASON, ruleset_id: "ruleset-1" }],
    gameweeks: [
      { id: GW1, season_id: SEASON, number: 1, status: "final", deadline_at: "2026-11-22T14:00:00.000Z" },
      { id: GW2, season_id: SEASON, number: 2, status: "open", deadline_at: DEADLINE },
    ],
    fantasy_teams: TEAMS.map((team) => ({ id: `team-${team}`, season_id: SEASON, user_id: `user-${team}`, name: `Squadra ${team}` })),
    private_leagues: [
      { id: "league-carry", settings: { missedLineup: "carry", defenseEnabled: false, captainEnabled: false, cleanSheetEnabled: false }, competition_format: "classic", start_matchday: 2, end_matchday: 38 },
      { id: "league-penalty", settings: { missedLineup: "penalty", missedLineupPenalty: PENALTY, defenseEnabled: false, captainEnabled: false, cleanSheetEnabled: false }, competition_format: "classic", start_matchday: 2, end_matchday: 38 },
    ],
    private_league_members: [
      ...["A", "B", "C"].map((team) => ({ private_league_id: "league-carry", fantasy_team_id: `team-${team}` })),
      ...["B", "D", "E"].map((team) => ({ private_league_id: "league-penalty", fantasy_team_id: `team-${team}` })),
    ],
    players,
    player_registrations: registrations,
    roster_stints: stints,
    lineups: [b1.lineup, a1.lineup, a2.lineup, e1.lineup],
    lineup_slots: [...b1.slots, ...a1.slots, ...a2.slots, ...e1.slots],
    player_gameweek_stats: [],
    real_matches: [{ id: "match-1", gameweek_id: GW2, home_club_id: "club-x", away_club_id: "club-y", status: "live", kickoff_at: "2026-11-29T14:00:00.000Z", postponed: false, hold_status: null }],
    vote_imports: [],
    team_gameweek_scores: [],
    lineup_player_scores: [],
  };
}

/** Voti finti: tutti 6, qualcuno con bonus. Il capitano ceduto da B segna, ma non deve contare. */
function fakeVotes() {
  const votes = TEAMS.flatMap((team) => squad(team)).map((player, index) => ({
    playerId: player.id,
    voto: 5.5 + (index % 4) * 0.5,
    goals: player.id.endsWith("FWD2") ? 1 : 0,
    assists: 0, yellowCards: index % 7 === 0 ? 1 : 0, redCards: 0, penaltiesScored: 0, penaltiesMissed: 0, penaltiesSaved: 0, ownGoals: 0, goalsConceded: 0,
  }));
  votes.push({ playerId: "B-NEW", voto: 7, goals: 2, assists: 0, yellowCards: 0, redCards: 0, penaltiesScored: 0, penaltiesMissed: 0, penaltiesSaved: 0, ownGoals: 0, goalsConceded: 0 });
  const sold = votes.find((vote) => vote.playerId === "B-FWD1")!;
  sold.voto = 9;
  sold.goals = 3;
  return votes;
}

export async function runOfficeLineupLiveChecks() {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };

  const tables = seed();
  const fake = new FakeSupabase(tables);
  const url = await fake.start();
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
  for (const name of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET"]) delete process.env[name];

  // Nessuna chiamata fuori dal finto Supabase: né la fonte dei voti né altro.
  const outside: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input);
    if (!target.startsWith(url)) {
      outside.push(new URL(target).host);
      throw new Error("Rete non permessa nella prova.");
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const { previewProvisional, scoreOfficialGameweek } = await import("../lib/server/live-score");
    const { fileForgottenLineups, planForgottenLineups } = await import("../lib/server/forgotten-lineup");
    const { saveProvisionalVotes } = await import("../lib/server/provisional-votes");
    const { loadLiveCenter } = await import("../lib/server/live-center");
    const { fantasyPointsForLeague } = await import("../lib/server/league-scores");
    const { teamWeekPoints } = await import("../lib/office-lineup");
    const { parseLeagueRules } = await import("../lib/league-rules");
    const { formationIssue } = await import("../lib/formations");

    // --- Regola dei punti, senza database
    const carry = parseLeagueRules({ missedLineup: "carry" });
    const penalty = parseLeagueRules({ missedLineup: "penalty", missedLineupPenalty: PENALTY });
    check("Regola: lega normale, d'ufficio conta i suoi punti", teamWeekPoints(carry, { points: 61, office: true }) === 61);
    check("Regola: lega normale, senza formazione nessun punto", teamWeekPoints(carry, { points: null, office: false }) === null);
    check("Regola: lega con penalità, d'ufficio vale la penalità", teamWeekPoints(penalty, { points: 61, office: true }) === PENALTY);
    check("Regola: lega con penalità, senza formazione vale la penalità", teamWeekPoints(penalty, { points: null, office: false }) === PENALTY);
    check("Regola: formazione salvata conta sempre i suoi punti", teamWeekPoints(penalty, { points: 61, office: false }) === 61);

    await saveProvisionalVotes(GW2, fakeVotes());
    const lineupsBefore = tables.lineups.length;
    const slotsBefore = tables.lineup_slots.length;
    const writesBefore = fake.writes().length;

    // --- Prima della chiusura: niente formazioni d'ufficio
    const early = await previewProvisional(GW2, BEFORE);
    check("Prima della chiusura nessuna formazione d'ufficio", early.lineups.every((lineup) => !lineup.office), early.lineups.filter((lineup) => lineup.office).map((lineup) => lineup.fantasyTeamId).join());

    // --- Dopo la chiusura (orologio finto, giornata ancora «open» nel database)
    const live = await previewProvisional(GW2, AFTER);
    const office = new Map(live.lineups.filter((lineup) => lineup.office).map((lineup) => [lineup.fantasyTeamId, lineup]));
    check("Dopo la chiusura: d'ufficio per B e C", office.size === 2 && ["team-B", "team-C"].every((team) => office.has(team)), [...office.keys()].join());
    check("A ha salvato: resta la sua, non d'ufficio", !office.has("team-A") && live.lineups.filter((lineup) => lineup.fantasyTeamId === "team-A").length === 1);
    check("D ed E sono solo in una lega con penalità: nessuna formazione d'ufficio", !live.lineups.some((lineup) => lineup.fantasyTeamId === "team-D" || lineup.fantasyTeamId === "team-E"));
    check("Una sola formazione per squadra", new Set(live.lineups.map((lineup) => lineup.fantasyTeamId)).size === live.lineups.length);

    const b = office.get("team-B");
    const bIds = (b?.slots ?? []).map((slot) => slot.playerId);
    const bStarters = (b?.slots ?? []).filter((slot) => slot.benchOrder == null).map((slot) => slot.playerId);
    const bRoster = squad("B").filter((player) => player.id !== "B-FWD1").concat({ id: "B-NEW", role: "FWD", name: "B nuovo attaccante" });
    check("B: il ceduto non c'è", !bIds.includes("B-FWD1"), bIds.join());
    check("B: il nuovo acquisto prende il suo posto", bStarters.includes("B-NEW"), bStarters.join());
    check("B: tutti e soli i calciatori in rosa", bIds.length === 20 && bRoster.every((player) => bIds.includes(player.id)), String(bIds.length));
    check("B: modulo ammesso", formationIssue(bRoster, bStarters) === null, String(formationIssue(bRoster, bStarters)));
    check("B: la fascia passa al vice", b?.slots.find((slot) => slot.isCaptain)?.playerId === "B-MID1");

    const c = office.get("team-C");
    const cStarters = (c?.slots ?? []).filter((slot) => slot.benchOrder == null).map((slot) => slot.playerId);
    check("C senza formazioni precedenti: 11 titolari d'ufficio in ordine alfabetico", cStarters.length === 11 && cStarters.includes("C-GK1") === false && cStarters.includes("C-GK2"), cStarters.join());

    const score = (teamId: string) => live.scores.find((item) => item.fantasyTeamId === teamId);
    check("B ha punti parziali", (score("team-B")?.provisionalTotal ?? 0) > 0 && (score("team-B")?.ratedPlayersCount ?? 0) === 11, JSON.stringify(score("team-B")?.provisionalTotal));
    check("I punti del ceduto non contano", !score("team-B")?.players.some((player) => player.playerId === "B-FWD1"));

    // --- «Senza voto» e «voto non ancora arrivato»
    const { playersWithVotesRead } = await import("../lib/lineups/votes-read");
    const { compactFromLive } = await import("../lib/lineups/compact-sheet");
    const clubs = new Map([["con-voto", "club-1"], ["compagno", "club-1"], ["altro", "club-2"], ["rinviato", "club-3"]]);
    const stat = (playerId: string, postponed = false) => [playerId, { playerId, role: "MID" as const, voto: postponed ? null : 6, postponed }] as const;
    const read = playersWithVotesRead(new Map([stat("con-voto"), stat("rinviato", true)]), clubs);
    check("Club con i voti: anche il compagno senza voto risulta letto", read.has("con-voto") && read.has("compagno"), [...read].join());
    check("Club senza voti o con partita rinviata: voto non ancora arrivato", !read.has("altro") && !read.has("rinviato"), [...read].join());
    check("Anteprima: dice per chi i voti sono arrivati", live.votesRead.has("B-GK1"));

    const row = (playerId: string, voto: number | null, waiting: boolean) => ({
      playerId, fullName: playerId, role: "MID" as const, clubShort: "X", isCaptain: false, isVice: false,
      voto, bonus: voto === null ? null : 0, malus: voto === null ? null : 0, fantavoto: voto, formula: null, waiting,
    });
    const shown = compactFromLive({
      starters: [row("t1", 6, false), row("t2", null, false), row("t3", null, true)],
      bench: [row("p1", 7, false)],
      partialTotal: 6,
    });
    check("Diretta: il senza voto è «S.V.», quello in attesa un trattino", shown.starters[1].emptyText === "S.V." && shown.starters[2].emptyText === "—");
    check("Diretta: in evidenza solo il titolare con voto", shown.starters.map((player) => player.played).join() === "true,false,false");
    check("Diretta: la panchina mostra il voto ma resta in secondo piano", shown.bench[0].vote === 7 && shown.bench[0].played === false);

    check("Anteprima: nessuna formazione scritta", tables.lineups.length === lineupsBefore && tables.lineup_slots.length === slotsBefore, `${tables.lineups.length} formazioni`);
    check("Anteprima: nessuna scrittura nel database", fake.writes().length === writesBefore, fake.writes().slice(writesBefore).map((call) => `${call.method} ${call.table}`).join());

    // --- Schermata live di una lega: punti e penalità con l'orologio dopo la chiusura
    const league = (id: string, teams: string[], rules: ReturnType<typeof parseLeagueRules>): LeagueDetail => ({
      id,
      name: id,
      seasonId: SEASON,
      startMatchday: 2,
      endMatchday: 38,
      rules,
      participants: teams.map((team) => ({ userId: `user-${team}`, fantasyTeamId: `team-${team}`, teamName: `Squadra ${team}`, displayName: team })),
    } as unknown as LeagueDetail);
    const carryLeague = league("league-carry", ["A", "B", "C"], parseLeagueRules({ missedLineup: "carry", defenseEnabled: false, captainEnabled: false, cleanSheetEnabled: false }));
    const penaltyLeague = league("league-penalty", ["B", "D", "E"], parseLeagueRules({ missedLineup: "penalty", missedLineupPenalty: PENALTY, defenseEnabled: false, captainEnabled: false, cleanSheetEnabled: false }));
    const centerB = await loadLiveCenter(carryLeague, "user-B", AFTER);
    check("Live: B vede la sua formazione d'ufficio", centerB.mine?.office === true && (centerB.mine?.starters.length ?? 0) === 11, JSON.stringify(centerB.mine?.office));
    check("Live: B vede i suoi punti parziali", centerB.mine?.total === score("team-B")?.provisionalTotal, `${centerB.mine?.total} / ${score("team-B")?.provisionalTotal}`);
    const centerPenalty = await loadLiveCenter(penaltyLeague, "user-B", AFTER);
    const livePenalty = new Map(centerPenalty.table.map((row) => [row.teamName, row.live]));
    check("Live, lega con penalità: B (d'ufficio) prende la penalità", livePenalty.get("Squadra B") === PENALTY, String(livePenalty.get("Squadra B")));
    check("Live, lega con penalità: D ed E (senza formazione) prendono la penalità", livePenalty.get("Squadra D") === PENALTY && livePenalty.get("Squadra E") === PENALTY, `${livePenalty.get("Squadra D")} ${livePenalty.get("Squadra E")}`);
    const earlyCenter = await loadLiveCenter(penaltyLeague, "user-D", BEFORE);
    check("Prima della chiusura nessuna penalità", earlyCenter.table.every((row) => row.live !== PENALTY), JSON.stringify(earlyCenter.table));

    const liveCarry = new Map(centerB.table.map((row) => [row.teamName, row.live]));
    const writesAfterScreens = fake.writes().length;
    check("Schermate live: nessuna scrittura", writesAfterScreens === writesBefore);

    // --- Due calcoli insieme: una sola formazione d'ufficio per squadra
    const plans = await planForgottenLineups(GW2);
    const [first, second] = await Promise.all([fileForgottenLineups(GW2), fileForgottenLineups(GW2)]);
    const perTeam = new Map<string, number>();
    for (const row of tables.lineups.filter((item) => item.gameweek_id === GW2)) {
      perTeam.set(String(row.fantasy_team_id), (perTeam.get(String(row.fantasy_team_id)) ?? 0) + 1);
    }
    check("Due calcoli insieme: nessun doppione", [...perTeam.values()].every((count) => count === 1) && first + second === 2, `${first}+${second}, ${JSON.stringify([...perTeam])}`);
    const filedB = tables.lineups.find((row) => row.gameweek_id === GW2 && row.fantasy_team_id === "team-B");
    const filedSlots = tables.lineup_slots.filter((slot) => slot.lineup_id === filedB?.id)
      .sort((left, right) => Number(right.is_starter) - Number(left.is_starter) || Number(left.slot_order) - Number(right.slot_order))
      .map((slot) => `${slot.player_id}:${slot.is_starter}:${slot.slot_order}:${slot.is_captain}:${slot.is_vice_captain}`);
    const shownSlots = (plans.get("team-B") ?? []).map((slot) => `${slot.player_id}:${slot.is_starter !== false}:${slot.slot_order}:${slot.is_captain}:${slot.is_vice_captain}`);
    check("Registrata identica a quella mostrata", filedB?.origin === "office" && JSON.stringify(filedSlots) === JSON.stringify(shownSlots), `${filedSlots.length} / ${shownSlots.length}`);
    const again = await fileForgottenLineups(GW2);
    check("Terzo giro: niente da registrare", again === 0);

    // --- Calcolo finale con gli stessi voti: i punti coincidono con quelli mostrati in diretta
    const votes = fakeVotes();
    tables.player_gameweek_stats.push(...votes.map((vote) => ({
      gameweek_id: GW2, player_id: vote.playerId, voto: vote.voto, goals: vote.goals, assists: vote.assists,
      yellow_cards: vote.yellowCards, red_cards: vote.redCards, penalties_scored: 0, penalties_missed: 0, penalties_saved: 0, own_goals: 0, goals_conceded: 0,
    })));
    tables.real_matches[0].status = "finished";
    tables.gameweeks[1].status = "locked";
    const official = await scoreOfficialGameweek(GW2);
    check("Calcolo ufficiale eseguito", official.skipped === false && official.teams === 3, JSON.stringify(official));
    const finalCarry = await fantasyPointsForLeague("league-carry", SEASON, ["team-A", "team-B", "team-C"], [{ id: GW2, number: 2 }]);
    const finalPenalty = await fantasyPointsForLeague("league-penalty", SEASON, ["team-B", "team-D", "team-E"], [{ id: GW2, number: 2 }]);
    for (const team of ["A", "B", "C"]) {
      check(`Lega normale, ${team}: diretta uguale al finale`, finalCarry.get(`team-${team}:${GW2}`) === liveCarry.get(`Squadra ${team}`), `${liveCarry.get(`Squadra ${team}`)} / ${finalCarry.get(`team-${team}:${GW2}`)}`);
    }
    for (const team of ["B", "D", "E"]) {
      check(`Lega con penalità, ${team}: diretta uguale al finale`, finalPenalty.get(`team-${team}:${GW2}`) === livePenalty.get(`Squadra ${team}`), `${livePenalty.get(`Squadra ${team}`)} / ${finalPenalty.get(`team-${team}:${GW2}`)}`);
    }

    check("Nessuna chiamata fuori dal finto database (fonte voti compresa)", outside.length === 0, outside.join());
  } finally {
    globalThis.fetch = realFetch;
    await fake.stop();
  }
  return { failures, total, passed: total - failures.length };
}

const direct = process.argv[1] && /test-office-lineup-live\.ts$/.test(process.argv[1].replace(/\\/g, "/"));
if (direct) {
  runOfficeLineupLiveChecks().then((result) => {
    console.log(`Formazione d'ufficio in diretta: ${result.failures.length === 0 ? "PASSED" : "FAILED"} ${result.passed}/${result.total}`);
    for (const failure of result.failures) console.log(`- ${failure}`);
    process.exit(result.failures.length === 0 ? 0 : 1);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
