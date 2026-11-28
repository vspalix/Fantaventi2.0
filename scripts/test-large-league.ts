// Leghe grandi: Supabase restituisce al massimo 1000 righe per richiesta e rifiuta gli indirizzi
// troppo lunghi. Classifica, finestre di mercato e schermate della lega devono vedere tutto.
// Finto Supabase in memoria (con gli stessi due limiti): nessun database vero, nessuna rete.
import { FakeSupabase, type Tables } from "./fake-supabase";

/** Codici lunghi come quelli veri, così anche gli indirizzi delle richieste hanno la lunghezza vera. */
function code(kind: number, index: number) {
  return `${String(kind).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Ogni squadra schiera un solo titolare: i suoi punti di giornata sono il voto. */
const voteOf = (index: number) => 5 + (index % 5) * 0.5;
const round2 = (value: number) => Math.round(value * 100) / 100;

type Setup = {
  key: number;
  teams: number;
  weeks: number;
  /** Calciatori per squadra: il primo è titolare, gli altri in panchina. */
  squad: number;
  /** La giornata della prima formazione; null per chi non ha mai schierato. */
  entry: (index: number) => number | null;
  /** La giornata da cui parte la rosa. */
  rosterFrom: (index: number) => number;
};

/** Una stagione intera: 30 squadre per 38 giornate, l'ultima entra alla giornata 20. */
const LONG: Setup = { key: 1, teams: 30, weeks: 38, squad: 1, entry: (index) => (index === 29 ? 20 : 1), rosterFrom: (index) => (index === 29 ? 20 : 1) };
/** Tantissime squadre: 600 schierano, 500 sono iscritte dalla giornata 2 e non hanno ancora schierato. */
const CROWD: Setup = { key: 2, teams: 1100, weeks: 2, squad: 2, entry: (index) => (index < 600 ? 1 : null), rosterFrom: (index) => (index < 600 ? 1 : 2) };

const seasonId = (setup: Setup) => code(setup.key * 10 + 1, 0);
const leagueId = (setup: Setup) => code(setup.key * 10 + 2, 0);
const teamId = (setup: Setup, index: number) => code(setup.key * 10 + 3, index);
const userId = (setup: Setup, index: number) => code(setup.key * 10 + 4, index);
const weekId = (setup: Setup, number: number) => code(setup.key * 10 + 5, number);
const playerId = (setup: Setup, index: number, spot: number) => code(setup.key * 10 + 6, index * 10 + spot);
const lineupId = (setup: Setup, index: number, number: number) => code(setup.key * 10 + 7, number * 10_000 + index);
/** Il totale salvato dal calcolo, diverso da quello ricalcolato per riconoscerlo. */
const storedTotal = (index: number) => 100 + voteOf(index);

const SETTINGS = { format: "classic", enrollment: "open", defenseEnabled: false, captainEnabled: false, cleanSheetEnabled: false };

function seed(setups: Setup[]): Tables {
  const tables: Tables = {
    rulesets: [{ id: "ruleset-1", definition: { lineup_size: 1, bonus_malus: {}, captain_modifier: [{ min_inclusive: 0, points: 0 }], double_captain_malus: false } }],
    seasons: [], gameweeks: [], private_leagues: [], private_league_members: [], fantasy_teams: [], profiles: [],
    players: [], player_registrations: [], roster_stints: [], lineups: [], lineup_slots: [], player_gameweek_stats: [],
    real_matches: [], team_gameweek_scores: [], lineup_player_scores: [], season_clubs: [], clubs: [], club_translations: [],
  };
  for (const setup of setups) {
    tables.seasons.push({ id: seasonId(setup), code: `stagione-${setup.key}`, status: "open", ruleset_id: "ruleset-1" });
    tables.private_leagues.push({
      id: leagueId(setup), name: `Lega ${setup.key}`, join_code: `CODICE${setup.key}`, season_id: seasonId(setup), owner_user_id: userId(setup, 0),
      settings: SETTINGS, competition_format: "classic", start_matchday: 1, end_matchday: setup.weeks, is_sandbox: false,
    });
    for (let number = 1; number <= setup.weeks; number += 1) {
      tables.gameweeks.push({ id: weekId(setup, number), season_id: seasonId(setup), number, status: "scored", deadline_at: new Date(Date.UTC(2025, 7, number)).toISOString() });
    }
    for (let index = 0; index < setup.teams; index += 1) {
      tables.fantasy_teams.push({ id: teamId(setup, index), user_id: userId(setup, index), season_id: seasonId(setup), name: `Squadra ${String(index).padStart(4, "0")}`, is_sandbox: false });
      tables.profiles.push({ id: userId(setup, index), display_name: `utente_${index}` });
      tables.private_league_members.push({ private_league_id: leagueId(setup), fantasy_team_id: teamId(setup, index) });
      for (let spot = 0; spot < setup.squad; spot += 1) {
        const player = playerId(setup, index, spot);
        tables.players.push({ id: player, full_name: `Calciatore ${index}-${spot}` });
        tables.player_registrations.push({ id: `reg-${player}`, player_id: player, season_id: seasonId(setup), role: "DEF", club_id: "club-x", effective_from_gameweek: 1, effective_to_gameweek: null });
        tables.roster_stints.push({ id: `stint-${player}`, fantasy_team_id: teamId(setup, index), player_id: player, active_from_gameweek: setup.rosterFrom(index), active_until_gameweek: null });
      }
    }
    // Righe in ordine di giornata, come arrivano nel database: il taglio colpisce le ultime.
    for (let number = 1; number <= setup.weeks; number += 1) {
      for (let index = 0; index < setup.teams; index += 1) {
        const entry = setup.entry(index);
        if (entry === null || number < entry) continue;
        const lineup = lineupId(setup, index, number);
        tables.lineups.push({ id: lineup, fantasy_team_id: teamId(setup, index), gameweek_id: weekId(setup, number), origin: "user" });
        for (let spot = 0; spot < setup.squad; spot += 1) {
          const player = playerId(setup, index, spot);
          tables.lineup_slots.push({ lineup_id: lineup, player_id: player, is_captain: false, is_vice_captain: false, is_starter: spot === 0, slot_order: spot + 1 });
          tables.player_gameweek_stats.push({
            id: `stat-${lineup}-${spot}`, gameweek_id: weekId(setup, number), player_id: player, voto: voteOf(index),
            goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, penalties_scored: 0, penalties_missed: 0, penalties_saved: 0, own_goals: 0, goals_conceded: 0,
          });
        }
        tables.team_gameweek_scores.push({ fantasy_team_id: teamId(setup, index), gameweek_id: weekId(setup, number), total: storedTotal(index) });
      }
    }
  }
  return tables;
}

const weeksOf = (setup: Setup) => Array.from({ length: setup.weeks }, (_, index) => ({
  id: weekId(setup, index + 1), number: index + 1, status: "scored", deadline_at: new Date(Date.UTC(2025, 7, index + 1)).toISOString(),
}));
const participantsOf = (setup: Setup) => Array.from({ length: setup.teams }, (_, index) => ({
  fantasyTeamId: teamId(setup, index), userId: userId(setup, index), teamName: `Squadra ${String(index).padStart(4, "0")}`, displayName: `utente_${index}`,
}));
const indexes = (count: number) => Array.from({ length: count }, (_, index) => index);

export async function runLargeLeagueChecks() {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };
  /** Una lettura che va in errore fa fallire la sua prova e lascia andare avanti le altre. */
  const attempt = async (name: string, run: () => Promise<string>) => {
    try {
      const problem = await run();
      check(name, problem === "", problem);
    } catch (error) {
      check(name, false, error instanceof Error ? error.message : String(error));
    }
  };
  /** Le prime squadre sbagliate, per capire il guasto senza stampare tutta la classifica. */
  const wrong = (items: string[]) => (items.length === 0 ? "" : `${items.length} sbagliate, per esempio ${items.slice(0, 2).join("; ")}`);

  const fake = new FakeSupabase(seed([LONG, CROWD]));
  const url = await fake.start();
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
  for (const name of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET"]) delete process.env[name];

  try {
    const { standingsFor, loadCalendarWeek, loadLeagueRosters, loadOpponentLineup } = await import("../lib/server/league-hub");
    const { loadCheckpointHistory } = await import("../lib/server/checkpoint-history");
    const { getLeagueDetail } = await import("../lib/server/leagues");
    const { parseLeagueRules } = await import("../lib/league-rules");
    const { createAdminSupabase } = await import("../lib/supabase/admin");

    const standings = (setup: Setup) => standingsFor(
      createAdminSupabase(),
      { id: leagueId(setup), seasonId: seasonId(setup), startMatchday: 1 },
      participantsOf(setup),
      weeksOf(setup),
      Date.now(),
      new Set<number>(),
    );

    // --- Una stagione intera: oltre 1000 formazioni e punteggi
    check("Nella prova ci sono più di 1000 formazioni e punteggi", fake.tables.lineups.filter((row) => String(row.gameweek_id).startsWith("00000015")).length > 1000);
    const lateAverage = indexes(29).reduce((sum, index) => sum + voteOf(index), 0) / 29;
    const lateTotal = round2(voteOf(29) * 19 + lateAverage * 19);

    await attempt("Stagione intera: punti e giornate schierate di tutte le squadre", async () => {
      const { rows } = await standings(LONG);
      return wrong(indexes(29).flatMap((index) => {
        const row = rows.find((item) => item.fantasyTeamId === teamId(LONG, index));
        return row && row.played === 38 && row.points === voteOf(index) * 38 ? [] : [`${row?.teamName}: ${row?.points} punti in ${row?.played} giornate`];
      }));
    });
    await attempt("Stagione intera: media di chi entra in corsa", async () => {
      const { rows } = await standings(LONG);
      const late = rows.find((row) => row.fantasyTeamId === teamId(LONG, 29));
      return late && late.played === 19 && late.skipped === 19 && late.entryPoints === round2(lateAverage * 19) && late.points === lateTotal
        ? "" : `${late?.points} (attesi ${lateTotal}), ${late?.played} giocate, ${late?.skipped} saltate`;
    });

    // Senza la tabella dei voti il ricalcolo fallisce e la classifica usa i punteggi salvati.
    const stats = fake.tables.player_gameweek_stats;
    delete fake.tables.player_gameweek_stats;
    await attempt("Stagione intera: classifica dai punteggi salvati, senza buchi", async () => {
      const { rows, weekPoints } = await standings(LONG);
      if (weekPoints !== null) return "la prova non è passata dai punteggi salvati";
      return wrong(indexes(29).flatMap((index) => {
        const row = rows.find((item) => item.fantasyTeamId === teamId(LONG, index));
        return row && row.points === storedTotal(index) * 38 ? [] : [`${row?.teamName}: ${row?.points}`];
      }));
    });
    fake.tables.player_gameweek_stats = stats;

    const history = (knownPoints: Map<string, number> | null, index: number) => loadCheckpointHistory({
      leagueId: leagueId(LONG),
      seasonId: seasonId(LONG),
      teamId: teamId(LONG, index),
      startMatchday: 1,
      checkpoints: [{ afterMatchday: 38 }] as Parameters<typeof loadCheckpointHistory>[0]["checkpoints"],
      participants: participantsOf(LONG),
      gameweeks: weeksOf(LONG),
      rules: parseLeagueRules(SETTINGS),
      knownPoints,
    });
    const computed = new Map(weeksOf(LONG).flatMap((week) => indexes(30).flatMap((index) => (
      week.number >= (LONG.entry(index) ?? 99) ? [[`${teamId(LONG, index)}:${week.id}`, voteOf(index)] as [string, number]] : []
    ))));
    await attempt("Finestre di mercato: giornate schierate complete", async () => {
      const full = (await history(computed, 28)).rows[0];
      const late = (await history(computed, 29)).rows[0];
      return full?.points === voteOf(28) * 38 && late?.points === lateTotal
        ? "" : `${full?.points} (attesi ${voteOf(28) * 38}), in corsa ${late?.points} (attesi ${lateTotal})`;
    });
    await attempt("Finestre di mercato: punteggi salvati completi", async () => {
      const row = (await history(null, 28)).rows[0];
      return row?.points === storedTotal(28) * 38 ? "" : `${row?.points} (attesi ${storedTotal(28) * 38})`;
    });

    // --- Tantissime squadre: oltre 1000 iscritte e indirizzi che non stanno in una richiesta
    const owner = userId(CROWD, 0);
    const crowdAverage = indexes(600).reduce((sum, index) => sum + voteOf(index), 0) / 600;

    await attempt("Partecipanti: tutte le squadre con il loro username", async () => {
      const detail = await getLeagueDetail(owner, leagueId(CROWD));
      const named = detail.participants.filter((participant) => participant.displayName !== "").length;
      return detail.participants.length === 1100 && named === 1100 ? "" : `${detail.participants.length} squadre, ${named} con nome`;
    });
    await attempt("Tante squadre: punti di chi schiera e media di chi aspetta", async () => {
      const { rows, weekPoints } = await standings(CROWD);
      if (weekPoints === null) return "il ricalcolo dei punti è fallito";
      const byTeam = new Map(rows.map((row) => [row.fantasyTeamId, row]));
      return wrong(indexes(1100).flatMap((index) => {
        const row = byTeam.get(teamId(CROWD, index));
        const expected = index < 600 ? voteOf(index) * 2 : round2(crowdAverage);
        return row && row.points === expected && row.skipped === (index < 600 ? 0 : 1) ? [] : [`${row?.teamName}: ${row?.points} (attesi ${expected})`];
      }));
    });
    /** La formazione ha il suo titolare e il suo panchinaro. */
    const complete = (opponent: { slots: { fullName: string }[]; bench: { fullName: string }[] } | undefined, index: number) => Boolean(
      opponent?.slots.length === 1 && opponent.bench.length === 1
      && opponent.slots[0].fullName === `Calciatore ${index}-0` && opponent.bench[0].fullName === `Calciatore ${index}-1`,
    );
    // L'ultima squadra che ha schierato guarda la lega: le sue righe sono oltre le prime mille.
    await attempt("Calendario: la propria formazione completa e punti di tutte le squadre", async () => {
      const week = await loadCalendarWeek(userId(CROWD, 599), leagueId(CROWD), weekId(CROWD, 2));
      const mine = week.opponents.find((opponent) => opponent.isMine);
      if (!complete(mine, 599)) return `la propria: ${mine?.slots.length} titolari, ${mine?.bench.length} in panchina`;
      const byTeam = new Map(week.opponents.map((opponent) => [opponent.fantasyTeamId, opponent]));
      const points = new Map(week.partial.map((row) => [row.fantasyTeamId, row.points]));
      return wrong(indexes(600).flatMap((index) => (
        byTeam.get(teamId(CROWD, index))?.filed && points.get(teamId(CROWD, index)) === voteOf(index)
          ? [] : [`Squadra ${index}: ${points.get(teamId(CROWD, index))} punti`]
      )));
    });
    await attempt("Lega grande: la pagina non porta le formazioni degli altri", async () => {
      const week = await loadCalendarWeek(owner, leagueId(CROWD), weekId(CROWD, 2));
      const heavy = week.opponents.filter((opponent) => !opponent.isMine && (!opponent.deferred || opponent.slots.length > 0 || opponent.bench.length > 0));
      const size = JSON.stringify(week).length;
      return heavy.length === 0 && size < 1_000_000 ? "" : `${heavy.length} formazioni intere, ${size} caratteri`;
    });
    await attempt("Lega grande: ogni formazione si apre a richiesta", async () => {
      const opened = await Promise.all([1, 599, 700].map((index) => loadOpponentLineup(owner, leagueId(CROWD), weekId(CROWD, 2), teamId(CROWD, index))));
      return complete(opened[0], 1) && complete(opened[1], 599) && opened[2].filed === false && !opened[0].deferred
        ? "" : opened.map((opponent) => `${opponent.teamName}: ${opponent.slots.length}+${opponent.bench.length}`).join(", ");
    });
    await attempt("Rose degli avversari: nessun calciatore perso", async () => {
      const players = indexes(1100).flatMap((index) => [0, 1].map((spot) => ({
        id: playerId(CROWD, index, spot), fullName: `Calciatore ${index}-${spot}`, role: "DEF" as const, clubId: "club-x", clubCode: "X", clubName: "X", clubShort: "X",
      })));
      const { squads } = await loadLeagueRosters(owner, leagueId(CROWD), 2, players);
      const short = squads.filter((squad) => squad.players.length !== 2);
      return squads.length === 1099 && short.length === 0 ? "" : `${squads.length} rose, ${short.length} incomplete`;
    });
    check("Nessuna scrittura nel database", fake.writes().length === 0, fake.writes().map((call) => `${call.method} ${call.table}`).slice(0, 3).join());
  } finally {
    await fake.stop();
  }
  return { total, passed: total - failures.length, failures };
}

runLargeLeagueChecks().then((result) => {
  console.log(`Leghe grandi: ${result.failures.length === 0 ? "PASSED" : "FAILED"} ${result.passed}/${result.total}`);
  for (const failure of result.failures) console.log(`- ${failure}`);
  process.exit(result.failures.length === 0 ? 0 : 1);
}).catch((error: unknown) => {
  console.log(`Leghe grandi: FAILED 0/1`);
  console.log(`- ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
