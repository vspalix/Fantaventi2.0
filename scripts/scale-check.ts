// Prova di carico a mano, fuori dalla suite: dati inventati in un finto Supabase, nessun database vero.
//   node --max-old-space-size=8192 --import tsx scripts/scale-check.ts sito 1000 100000
//   node --max-old-space-size=8192 --import tsx scripts/scale-check.ts lega 10 100 500 1000
//   node --max-old-space-size=8192 --import tsx scripts/scale-check.ts calcolo 100000
// I tempi comprendono il finto database sullo stesso PC: contano soprattutto richieste e peso.
import { FakeSupabase, type Tables } from "./fake-supabase";

const CLOSED = 20;
const LIVE = CLOSED + 1;
const CLUBS = 20;
const PER_CLUB = 30;
const LEAGUE_SIZE = 10;
const SEASON = "00000001-0000-4000-8000-000000000000";

const code = (kind: number, index: number) => `${String(kind).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
const teamId = (index: number) => code(3, index);
const userId = (index: number) => code(4, index);
const weekId = (number: number) => code(5, number);
const leagueId = (index: number) => code(2, index);
const playerId = (club: number, spot: number) => code(6, club * 100 + spot);
/** La rosa di una squadra: un calciatore per club. */
const squad = (team: number) => Array.from({ length: CLUBS }, (_, club) => playerId(club, (team + club * 7) % PER_CLUB));
const settings = { format: "classic", enrollment: "open", visibility: "public" };

type World = {
  /** Squadre in tutto il sito. */
  teams: number;
  /** Squadre della lega guardata (la prima). */
  focus: number;
  /** Le altre squadre schierano nella giornata in corso, tranne una su dieci. */
  crowdFields: boolean;
};

function seed(world: World): Tables {
  const tables: Tables = {
    seasons: [{ id: SEASON, code: "2026-27", status: "running", ruleset_id: "ruleset-1", competition_id: "competition-1", starts_on: "2026-08-01" }],
    rulesets: [{ id: "ruleset-1", definition: { lineup_size: 11, bonus_malus: { goal: 3, assist: 1, yellow_card: -0.5 }, captain_modifier: [{ min_inclusive: 0, points: 0 }], double_captain_malus: false } }],
    competitions: [{ id: "competition-1", code: "serie_a" }],
    competition_translations: [{ competition_id: "competition-1", locale: "it", name: "Serie A" }],
    gameweeks: [], clubs: [], club_translations: [], season_clubs: [], players: [], player_registrations: [], real_matches: [],
    player_gameweek_stats: [], private_leagues: [], private_league_members: [], fantasy_teams: [], profiles: [], roster_stints: [],
    lineups: [], lineup_slots: [], team_gameweek_scores: [], lineup_player_scores: [], player_availability: [], league_delegates: [],
    vote_imports: [], engagement_notices: [], app_settings: [], system_settings: [],
  };
  const hour = 60 * 60 * 1000;
  for (let number = 1; number <= 38; number += 1) {
    const offset = (number - LIVE) * 7 * 24 * hour;
    const deadline = new Date(Date.now() - hour + offset).toISOString();
    tables.gameweeks.push({ id: weekId(number), season_id: SEASON, number, deadline_at: deadline, status: number < LIVE ? "scored" : number === LIVE ? "locked" : "scheduled" });
    for (let match = 0; match < CLUBS / 2; match += 1) {
      tables.real_matches.push({
        id: code(8, number * 100 + match), gameweek_id: weekId(number), home_club_id: code(9, match * 2), away_club_id: code(9, match * 2 + 1),
        kickoff_at: deadline, status: number < LIVE ? "finished" : number === LIVE ? "live" : "scheduled", postponed: false, hold_status: "none", home_goals: null, away_goals: null,
      });
    }
  }
  for (let club = 0; club < CLUBS; club += 1) {
    const id = code(9, club);
    tables.clubs.push({ id, code: `c${club}`, competition_id: "competition-1" });
    tables.club_translations.push({ club_id: id, locale: "it", name: `Club ${club}`, short_name: `C${club}` });
    tables.season_clubs.push({ season_id: SEASON, club_id: id });
    for (let spot = 0; spot < PER_CLUB; spot += 1) {
      const player = playerId(club, spot);
      const role = spot < 3 ? "GK" : spot < 12 ? "DEF" : spot < 22 ? "MID" : "FWD";
      tables.players.push({ id: player, full_name: `Calciatore ${club}-${spot}` });
      tables.player_registrations.push({ id: `reg-${player}`, season_id: SEASON, player_id: player, role, club_id: id, effective_from_gameweek: 1, effective_to_gameweek: null });
      for (let number = 1; number <= LIVE; number += 1) {
        tables.player_gameweek_stats.push({
          id: `${weekId(number)}:${player}`, gameweek_id: weekId(number), player_id: player, voto: 5 + ((club + spot + number) % 6) * 0.5,
          goals: (spot + number) % 11 === 0 ? 1 : 0, assists: 0, yellow_cards: 0, red_cards: 0, penalties_scored: 0, penalties_missed: 0, penalties_saved: 0, own_goals: 0, goals_conceded: 0, postponed: false,
        });
      }
    }
  }
  const leagueOf = (team: number) => (team < world.focus ? 0 : 1 + Math.floor((team - world.focus) / LEAGUE_SIZE));
  for (let team = 0; team < world.teams; team += 1) {
    const league = leagueOf(team);
    if (team === 0 || league !== leagueOf(team - 1)) {
      tables.private_leagues.push({
        id: leagueId(league), name: `Lega ${String(league).padStart(6, "0")}`, join_code: `C${league}`, season_id: SEASON, owner_user_id: userId(team),
        settings, competition_format: "classic", start_matchday: 1, end_matchday: 38, is_sandbox: false,
      });
    }
    tables.fantasy_teams.push({ id: teamId(team), user_id: userId(team), season_id: SEASON, name: `Squadra ${String(team).padStart(6, "0")}`, is_sandbox: false });
    tables.profiles.push({ id: userId(team), display_name: `utente_${team}` });
    tables.private_league_members.push({ private_league_id: leagueId(league), fantasy_team_id: teamId(team) });
    const own = squad(team);
    const forgetful = team >= world.focus && team % 10 === 0;
    if (league === 0 || forgetful) {
      own.forEach((player, index) => tables.roster_stints.push({ id: `s-${team}-${index}`, fantasy_team_id: teamId(team), player_id: player, active_from_gameweek: 1, active_until_gameweek: null }));
    }
    const first = league === 0 ? 1 : LIVE;
    for (let number = first; number <= LIVE; number += 1) {
      if (league !== 0 && (!world.crowdFields || forgetful)) continue;
      const id = code(7, team * 100 + number);
      tables.lineups.push({ id, fantasy_team_id: teamId(team), gameweek_id: weekId(number), origin: "user", status: "locked", saved_at: null });
      own.forEach((player, index) => tables.lineup_slots.push({ lineup_id: id, player_id: player, is_captain: index === 1, is_vice_captain: index === 2, is_starter: index < 11, slot_order: index + 1 }));
      if (number < LIVE) tables.team_gameweek_scores.push({ fantasy_team_id: teamId(team), gameweek_id: weekId(number), total: 60 + (team % 20), is_live: false, provisional_total: null });
    }
  }
  return tables;
}

async function start(world: World) {
  const fake = new FakeSupabase(seed(world), { indexed: true });
  const url = await fake.start();
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
  for (const name of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET"]) delete process.env[name];
  return fake;
}

async function measure(fake: FakeSupabase, label: string, run: () => Promise<unknown>) {
  const requests = fake.calls.length;
  const sent = fake.sent;
  const started = performance.now();
  let note = "";
  let page = 0;
  try {
    const result = await run();
    page = Buffer.byteLength(JSON.stringify(result ?? null));
  } catch (error) {
    note = `ERRORE: ${error instanceof Error ? error.message : String(error)}`;
  }
  const size = (bytes: number) => (bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`);
  console.log(`${label.padEnd(26)} ${String(fake.calls.length - requests).padStart(6)} richieste  dal database ${size(fake.sent - sent).padStart(9)}  alla schermata ${size(page).padStart(9)}  ${((performance.now() - started) / 1000).toFixed(1).padStart(6)} s ${note}`);
}

async function screens(fake: FakeSupabase) {
  const { loadLeagueHub, loadCalendarWeek } = await import("../lib/server/league-hub");
  const { listLeaguesForUser, listPublicLeagues, getLeagueDetail } = await import("../lib/server/leagues");
  const { loadLiveCenter } = await import("../lib/server/live-center");
  const { loadScoreAudit } = await import("../lib/server/score-audit");
  const user = userId(0);
  await measure(fake, "Le mie leghe", () => listLeaguesForUser(user));
  await measure(fake, "Leghe pubbliche", () => listPublicLeagues(user));
  await measure(fake, "Pagina della lega (live)", () => loadLeagueHub(user, leagueId(0)));
  await measure(fake, "Giornata calcolata", () => loadCalendarWeek(user, leagueId(0), weekId(CLOSED)));
  await measure(fake, "Centro partite", async () => loadLiveCenter(await getLeagueDetail(user, leagueId(0)), user));
  await measure(fake, "Dettaglio di una squadra", () => loadScoreAudit(user, leagueId(0), weekId(CLOSED), teamId(0), "member"));
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const sizes = rest.map(Number).filter((size) => size > 0);
  if (mode !== "sito" && mode !== "lega" && mode !== "calcolo") throw new Error("Scrivi: sito, lega oppure calcolo, poi i numeri di squadre.");
  // Il client del database si crea una volta sola: ogni misura in un processo a parte, se le misure sono più di una.
  if (sizes.length > 1) {
    const { spawnSync } = await import("node:child_process");
    for (const size of sizes) spawnSync(process.execPath, [...process.execArgv, process.argv[1], mode, String(size)], { stdio: ["ignore", "inherit", "ignore"] });
    return;
  }
  const size = sizes[0] ?? 1000;
  if (mode === "sito") {
    const fake = await start({ teams: size, focus: LEAGUE_SIZE, crowdFields: true });
    console.log(`\n== Sito con ${size} squadre (${Math.ceil(size / LEAGUE_SIZE)} leghe), si guarda una lega da ${LEAGUE_SIZE}`);
    await screens(fake);
    await fake.stop();
  } else if (mode === "lega") {
    const fake = await start({ teams: size, focus: size, crowdFields: false });
    console.log(`\n== Una sola lega da ${size} squadre, ${CLOSED} giornate calcolate e una in corso`);
    await screens(fake);
    await fake.stop();
  } else {
    const fake = await start({ teams: size, focus: LEAGUE_SIZE, crowdFields: true });
    console.log(`\n== Calcolo di una giornata con ${size} squadre (una su dieci non ha salvato)`);
    const { refreshProvisionalScores, scoreOfficialGameweek } = await import("../lib/server/live-score");
    await measure(fake, "Punti provvisori", () => refreshProvisionalScores(weekId(LIVE)));
    for (const match of fake.tables.real_matches) if (match.gameweek_id === weekId(LIVE)) match.status = "finished";
    await measure(fake, "Calcolo ufficiale", () => scoreOfficialGameweek(weekId(LIVE)));
    const official = fake.tables.team_gameweek_scores.filter((row) => row.gameweek_id === weekId(LIVE) && row.is_live === false).length;
    console.log(`Squadre con il punteggio ufficiale: ${official} di ${size}. Memoria usata: ${Math.round(process.memoryUsage().rss / 1_000_000)} MB (dati finti compresi).`);
    await fake.stop();
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
