// Albo d'oro: il podio è la classifica della lega (scontri diretti, ingresso in corsa)
// e le statistiche usano gli stessi punti. Finto Supabase in memoria: nessun database vero, nessuna rete.
import { FakeSupabase, type Row, type Tables } from "./fake-supabase";

const SEASON = "season-closed";
const WEEKS = [1, 2, 3];
const STARTERS = ["GK1", "DEF1", "DEF2", "DEF3", "DEF4", "MID1", "MID2", "MID3", "FWD1", "FWD2", "FWD3"];

/** Il voto di tutti gli undici di una squadra in ogni giornata; null = quella giornata non ha schierato. */
const VOTES: Record<string, (number | null)[]> = {
  // Scontri diretti: A vince due volte di poco, B una volta di molto e somma più fantapunti.
  A: [6.5, 6.5, 5],
  B: [6, 6, 9],
  // Classifica a somma: D entra dalla seconda giornata e per la prima riceve la media.
  C: [6, 6, 6],
  D: [null, 7, 7],
};

function seed(): Tables {
  const tables: Tables = {
    seasons: [{ id: SEASON, code: "2025-26", status: "closed", ruleset_id: "ruleset-1" }],
    rulesets: [{ id: "ruleset-1", definition: { lineup_size: 11, bonus_malus: {}, captain_modifier: [{ min_inclusive: 0, points: 0 }], double_captain_malus: false } }],
    gameweeks: WEEKS.map((number) => ({ id: `gw-${number}`, season_id: SEASON, number, status: "final", deadline_at: `2025-09-0${number}T14:00:00.000Z` })),
    private_leagues: [
      { id: "league-h2h", name: "Scontri", season_id: SEASON, settings: { format: "h2h", defenseEnabled: false, captainEnabled: false }, competition_format: "h2h", start_matchday: 1, end_matchday: 3 },
      { id: "league-late", name: "Somma", season_id: SEASON, settings: { format: "classic", enrollment: "open", defenseEnabled: false, captainEnabled: false }, competition_format: "classic", start_matchday: 1, end_matchday: 3 },
    ],
    private_league_members: Object.keys(VOTES).map((team) => ({
      private_league_id: team === "A" || team === "B" ? "league-h2h" : "league-late", fantasy_team_id: `team-${team}`,
    })),
    fantasy_teams: Object.keys(VOTES).map((team) => ({ id: `team-${team}`, name: `Squadra ${team}`, user_id: `user-${team}` })),
    profiles: Object.keys(VOTES).map((team) => ({ id: `user-${team}`, display_name: `utente_${team}` })),
    players: [], player_registrations: [], roster_stints: [], lineups: [], lineup_slots: [], player_gameweek_stats: [],
    real_matches: [], team_gameweek_scores: [],
  };
  for (const [team, votes] of Object.entries(VOTES)) {
    for (const short of STARTERS) {
      const id = `${team}-${short}`;
      const role = short.slice(0, -1);
      tables.players.push({ id, full_name: id });
      tables.player_registrations.push({ id: `reg-${id}`, player_id: id, season_id: SEASON, role, club_id: "club-x", effective_from_gameweek: 1, effective_to_gameweek: null });
      tables.roster_stints.push({ id: `stint-${id}`, fantasy_team_id: `team-${team}`, player_id: id, active_from_gameweek: 1, active_until_gameweek: null });
    }
    votes.forEach((vote, index) => {
      if (vote === null) return;
      const gameweek = `gw-${index + 1}`;
      const lineup = `lineup-${team}-${index + 1}`;
      tables.lineups.push({ id: lineup, fantasy_team_id: `team-${team}`, gameweek_id: gameweek, origin: "user" } as Row);
      STARTERS.forEach((short, order) => {
        tables.lineup_slots.push({ lineup_id: lineup, player_id: `${team}-${short}`, is_captain: false, is_vice_captain: false, is_starter: true, slot_order: order + 1 });
        tables.player_gameweek_stats.push({
          id: `stat-${team}-${short}-${gameweek}`, gameweek_id: gameweek, player_id: `${team}-${short}`, voto: vote,
          goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, penalties_scored: 0, penalties_missed: 0, penalties_saved: 0, own_goals: 0, goals_conceded: 0, postponed: false,
        });
      });
    });
  }
  return tables;
}

export async function runHallOfFameChecks() {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };

  const fake = new FakeSupabase(seed());
  const url = await fake.start();
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
  for (const name of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET"]) delete process.env[name];

  try {
    const { loadHallOfFame, leagueAwards } = await import("../lib/server/hall-of-fame");
    const { fantasyPointsForLeague } = await import("../lib/server/league-scores");

    // --- Statistiche, senza database
    const names = new Map([["a", "Alfa"], ["b", "Beta"]]);
    const row = (teamId: string, gameweekId: string, points: number, captain = 0, defense = 0, fairPlay = 0) => ({ teamId, gameweekId, total: points, captain, defense, fairPlay });
    const awards = leagueAwards([row("a", "g1", 70, 1, 0, 2.5), row("b", "g1", 70, 0.5, 6), row("a", "g2", 80, 1.5, 0, 2.5), row("b", "g2", 75, 0.5, 3, 2.5)], names);
    check("Primo di giornata: la parità conta per tutti", awards.roundWins?.value === 2 && awards.roundWins.teams.join() === "Alfa", JSON.stringify(awards.roundWins));
    check("Capitano e difesa: somma dei punti", awards.captain?.value === 2.5 && awards.defense?.value === 9 && awards.defense.teams.join() === "Beta");
    check("Fair play: giornate con il bonus", awards.fairPlay?.value === 2 && awards.fairPlay.teams.join() === "Alfa");
    check("Regola spenta: la statistica non compare", leagueAwards([row("a", "g1", 50)], names).captain === null);

    const board = await loadHallOfFame();
    const leagues = new Map(board.seasons[0]?.leagues.map((league) => [league.leagueName, league]));
    const duel = leagues.get("Scontri");
    const sum = leagues.get("Somma");

    const duelPoints = await fantasyPointsForLeague("league-h2h", SEASON, ["team-A", "team-B"], WEEKS.map((number) => ({ id: `gw-${number}`, number })));
    const fantasy = (team: string) => WEEKS.reduce((all, number) => all + (duelPoints.get(`team-${team}:gw-${number}`) ?? 0), 0);
    check("Nella prova B somma più fantapunti di A", fantasy("B") > fantasy("A"), `${fantasy("A")} / ${fantasy("B")}`);
    check(
      "Scontri diretti: vince chi ha più punti, non più fantapunti",
      duel?.podium[0]?.teamName === "Squadra A" && duel.podium[0].points === 6 && duel.podium[1]?.points === 3,
      JSON.stringify(duel?.podium),
    );
    check("Scontri diretti: il podio conta i punti", duel?.unit === "punti", String(duel?.unit));
    check("Scontri diretti: il record di giornata resta in fantapunti", duel?.bestWeek?.teamName === "Squadra B" && duel.bestWeek.gameweek === 3 && duel.bestWeek.points > 90, JSON.stringify(duel?.bestWeek));
    check("Scontri diretti: due volte primo di giornata per A", duel?.roundWins?.value === 2 && duel.roundWins.teams.join() === "Squadra A", JSON.stringify(duel?.roundWins));

    const late = sum?.podium.find((place) => place.teamName === "Squadra D");
    const early = sum?.podium.find((place) => place.teamName === "Squadra C");
    const own = await fantasyPointsForLeague("league-late", SEASON, ["team-C", "team-D"], WEEKS.map((number) => ({ id: `gw-${number}`, number })));
    const expected = (own.get("team-C:gw-1") ?? 0) + (own.get("team-D:gw-2") ?? 0) + (own.get("team-D:gw-3") ?? 0);
    check("Ingresso in corsa: la media della giornata saltata entra nel totale", late?.points === expected && late.rank === 1, `${late?.points} / ${expected}`);
    check("Ingresso in corsa: senza media D sarebbe dietro", (early?.points ?? 0) > expected - (own.get("team-C:gw-1") ?? 0), JSON.stringify(sum?.podium));
    check("Classifica a somma: il podio conta i fantapunti", sum?.unit === "fantapunti");
    check("Nome squadra e username sul podio", late?.displayName === "utente_D", String(late?.displayName));
    check("Albo: nessuna scrittura nel database", fake.writes().length === 0, fake.writes().map((call) => `${call.method} ${call.table}`).join());
  } finally {
    await fake.stop();
  }
  return { total, passed: total - failures.length, failures };
}

runHallOfFameChecks().then((result) => {
  console.log(`Albo d'oro: ${result.failures.length === 0 ? "PASSED" : "FAILED"} ${result.passed}/${result.total}`);
  for (const failure of result.failures) console.log(`- ${failure}`);
  process.exit(result.failures.length === 0 ? 0 : 1);
}).catch((error: unknown) => {
  console.log(`Albo d'oro: FAILED 0/1`);
  console.log(`- ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
