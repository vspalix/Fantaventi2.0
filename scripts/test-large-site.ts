// Sito grande: calcolo della giornata, formazioni d'ufficio, punti provvisori, promemoria,
// leghe pubbliche e Albo d'oro con più di mille squadre.
// Finto Supabase in memoria (tetto di 1000 righe e indirizzi lunghi rifiutati): nessun database vero, nessuna rete.
import { FakeSupabase, type Row, type Tables } from "./fake-supabase";
import type { PlayerRole } from "../lib/types";

const SEASON = "00000091-0000-4000-8000-000000000000";
const OLD = "00000090-0000-4000-8000-000000000000";
const code = (kind: number, index: number) => `${String(kind).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
const teamId = (index: number) => code(3, index);
const userId = (index: number) => code(4, index);
const leagueId = (index: number) => code(2, index);
const weekId = (number: number) => code(5, number);

/** 1300 squadre in 130 leghe: le ultime 100 non salvano la giornata 2. */
const TEAMS = 1300;
const FILED = 1200;
const LEAGUES = TEAMS / 10;
const PUBLIC = 45;
const OLD_LEAGUES = 25;

const SHAPE: [PlayerRole, number][] = [["GK", 2], ["DEF", 6], ["MID", 7], ["FWD", 5]];
const PLAYERS = SHAPE.flatMap(([role, count]) => Array.from({ length: count }, (_, index) => ({ id: `${role}${index + 1}`, role })));
const STARTERS = ["GK1", "DEF1", "DEF2", "DEF3", "DEF4", "MID1", "MID2", "MID3", "FWD1", "FWD2", "FWD3"];

const WEEK1 = "2026-11-14T14:00:00.000Z";
const WEEK2 = "2026-11-21T14:00:00.000Z";
/** Sabato alle 14:59 italiane: il promemoria parte con la sveglia delle 08:30. */
const WEEK3 = "2026-11-28T13:59:00.000Z";
const REMINDER_AT = Date.parse("2026-11-28T07:30:00.000Z");

function seed(): Tables {
  const tables: Tables = {
    rulesets: [{ id: "ruleset-1", definition: { lineup_size: 11, bonus_malus: {}, captain_modifier: [{ min_inclusive: 0, points: 0 }], double_captain_malus: false } }],
    seasons: [
      { id: SEASON, code: "2026-27", status: "running", ruleset_id: "ruleset-1", competition_id: "competition-1", starts_on: "2026-08-01" },
      { id: OLD, code: "2025-26", status: "closed", ruleset_id: "ruleset-1", competition_id: "competition-1", starts_on: "2025-08-01" },
    ],
    competitions: [{ id: "competition-1", code: "serie_a" }],
    competition_translations: [{ competition_id: "competition-1", locale: "it", name: "Serie A" }],
    gameweeks: [
      { id: weekId(1), season_id: SEASON, number: 1, status: "final", deadline_at: WEEK1 },
      { id: weekId(2), season_id: SEASON, number: 2, status: "locked", deadline_at: WEEK2 },
      { id: weekId(3), season_id: SEASON, number: 3, status: "open", deadline_at: WEEK3 },
      { id: weekId(90), season_id: OLD, number: 1, status: "final", deadline_at: "2025-09-01T14:00:00.000Z" },
    ],
    real_matches: [
      { id: "m2", gameweek_id: weekId(2), home_club_id: "club-x", away_club_id: "club-y", status: "live", kickoff_at: WEEK2, postponed: false, hold_status: "none" },
      { id: "m3", gameweek_id: weekId(3), home_club_id: "club-x", away_club_id: "club-y", status: "scheduled", kickoff_at: "2026-11-28T14:00:00.000Z", postponed: false, hold_status: "none" },
    ],
    players: PLAYERS.map((player) => ({ id: player.id, full_name: `Calciatore ${player.id}` })),
    player_registrations: PLAYERS.map((player) => ({ id: `reg-${player.id}`, season_id: SEASON, player_id: player.id, role: player.role, club_id: "club-x", effective_from_gameweek: 1, effective_to_gameweek: null })),
    player_gameweek_stats: PLAYERS.map((player) => ({
      id: `stat-${player.id}`, gameweek_id: weekId(2), player_id: player.id, voto: 6,
      goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, penalties_scored: 0, penalties_missed: 0, penalties_saved: 0, own_goals: 0, goals_conceded: 0,
    })),
    private_leagues: [], private_league_members: [], fantasy_teams: [], profiles: [], roster_stints: [], lineups: [], lineup_slots: [],
    team_gameweek_scores: [], lineup_player_scores: [], vote_imports: [], engagement_notices: [],
    system_settings: [{ id: 1, auto_sync_enabled: true, lineup_reminder_enabled: true, lineup_reminder_lead_minutes: 180 }],
  };
  const addLineup = (team: number, number: number, shorts: string[]) => {
    const id = code(7, team * 10 + number);
    tables.lineups.push({ id, fantasy_team_id: teamId(team), gameweek_id: weekId(number), status: "locked", origin: "user" } as Row);
    shorts.forEach((short, index) => tables.lineup_slots.push({
      lineup_id: id, player_id: short, is_captain: false, is_vice_captain: false, is_starter: STARTERS.includes(short), slot_order: index + 1,
    }));
  };
  for (let league = 0; league < LEAGUES; league += 1) {
    tables.private_leagues.push({
      id: leagueId(league), name: `Lega ${String(league).padStart(3, "0")}`, join_code: `C${league}`, season_id: SEASON, owner_user_id: userId(league * 10),
      settings: { missedLineup: "carry", visibility: league < PUBLIC ? "public" : "private", captainEnabled: false, defenseEnabled: false, cleanSheetEnabled: false },
      competition_format: "classic", start_matchday: 1, end_matchday: 38, is_sandbox: false,
    });
  }
  for (let team = 0; team < TEAMS; team += 1) {
    tables.fantasy_teams.push({ id: teamId(team), season_id: SEASON, user_id: userId(team), name: `Squadra ${team}`, is_sandbox: false });
    tables.profiles.push({ id: userId(team), display_name: `utente_${team}` });
    tables.private_league_members.push({ private_league_id: leagueId(Math.floor(team / 10)), fantasy_team_id: teamId(team) });
    if (team < FILED) {
      addLineup(team, 2, ["MID1"]);
    } else {
      PLAYERS.forEach((player) => tables.roster_stints.push({ id: `s-${team}-${player.id}`, fantasy_team_id: teamId(team), player_id: player.id, active_from_gameweek: 1, active_until_gameweek: null }));
      addLineup(team, 1, [...STARTERS, ...PLAYERS.map((player) => player.id).filter((id) => !STARTERS.includes(id))]);
    }
  }
  // Una stagione conclusa con più leghe di una pagina: chi guarda è nell'ultima per nome.
  for (let league = 0; league < OLD_LEAGUES; league += 1) {
    tables.private_leagues.push({ id: code(8, league), name: `Vecchia ${String(league).padStart(2, "0")}`, season_id: OLD, settings: {}, competition_format: "classic", start_matchday: 1, end_matchday: 1 });
    const team = code(6, league);
    tables.fantasy_teams.push({ id: team, season_id: OLD, user_id: league === OLD_LEAGUES - 1 ? userId(0) : code(9, league), name: `Storica ${league}` });
    tables.private_league_members.push({ private_league_id: code(8, league), fantasy_team_id: team });
  }
  return tables;
}

export async function runLargeSiteChecks() {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };
  const attempt = async (name: string, run: () => Promise<string>) => {
    try {
      const problem = await run();
      check(name, problem === "", problem);
    } catch (error) {
      check(name, false, error instanceof Error ? error.message : String(error));
    }
  };

  const fake = new FakeSupabase(seed(), { indexed: true });
  const url = await fake.start();
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
  for (const name of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET"]) delete process.env[name];

  const rows = (table: string, week: number) => fake.tables[table].filter((row) => row.gameweek_id === weekId(week));

  try {
    const { previewProvisional, refreshProvisionalScores, scoreOfficialGameweek } = await import("../lib/server/live-score");
    const { listPublicLeagues } = await import("../lib/server/leagues");
    const { loadHallOfFame } = await import("../lib/server/hall-of-fame");
    const { liveDeps, runLineupReminder } = await import("../lib/server/lineup-reminder");
    const { createAdminSupabase } = await import("../lib/supabase/admin");

    await attempt("Diretta di una lega: solo le sue squadre, formazioni d'ufficio comprese", async () => {
      const own = [teamId(0), teamId(TEAMS - 1)];
      const preview = await previewProvisional(weekId(2), new Date(), own);
      const ids = preview.lineups.map((lineup) => lineup.fantasyTeamId).sort();
      return ids.join() === [...own].sort().join() && preview.lineups.some((lineup) => lineup.office) ? "" : `${ids.length} formazioni`;
    });

    // Una riga già ufficiale non deve tornare provvisoria.
    fake.tables.team_gameweek_scores.push({ fantasy_team_id: teamId(5), gameweek_id: weekId(2), ruleset_id: "ruleset-1", total: 99, is_live: false });
    await attempt("Punti provvisori: tutte le formazioni, senza toccare quelli ufficiali", async () => {
      const outcome = await refreshProvisionalScores(weekId(2));
      const saved = rows("team_gameweek_scores", 2);
      const official = saved.find((row) => row.fantasy_team_id === teamId(5));
      const live = saved.filter((row) => row.is_live === true && Number(row.provisional_total) === 6).length;
      return outcome.teams === FILED && saved.length === FILED && live === FILED - 1 && official?.total === 99 && official.is_live === false
        ? "" : `${outcome.teams} calcolate, ${saved.length} righe, ${live} in diretta, ufficiale ${official?.total}`;
    });

    fake.tables.real_matches.find((match) => match.id === "m2")!.status = "finished";
    const result = () => {
      const saved = rows("team_gameweek_scores", 2);
      const lineups = rows("lineups", 2);
      const office = lineups.filter((row) => row.origin === "office");
      const officeIds = new Set(office.map((row) => row.id));
      return {
        scored: saved.filter((row) => row.is_live === false).length,
        lineups: lineups.length,
        office: office.length,
        slots: fake.tables.lineup_slots.filter((slot) => officeIds.has(slot.lineup_id)).length,
        players: rows("lineup_player_scores", 2).length,
        forgetful: saved.find((row) => row.fantasy_team_id === teamId(TEAMS - 1))?.total,
      };
    };
    await attempt("Calcolo ufficiale: tutte le squadre, con le formazioni d'ufficio", async () => {
      const outcome = await scoreOfficialGameweek(weekId(2));
      const now = result();
      return outcome.teams === TEAMS && now.scored === TEAMS && now.lineups === TEAMS && now.office === TEAMS - FILED
        && now.slots === (TEAMS - FILED) * PLAYERS.length && now.forgetful === 66 && now.players >= FILED + (TEAMS - FILED) * 11
        ? "" : JSON.stringify({ teams: outcome.teams, ...now });
    });
    await attempt("Calcolo ripetuto: niente doppioni", async () => {
      const before = result();
      await scoreOfficialGameweek(weekId(2), { allowRewrite: true });
      const after = result();
      return JSON.stringify(after) === JSON.stringify(before) ? "" : `${JSON.stringify(before)} → ${JSON.stringify(after)}`;
    });

    fake.tables.gameweeks.find((week) => week.id === weekId(2))!.status = "scored";
    fake.tables.real_matches.find((match) => match.id === "m2")!.status = "finished";
    const reached: string[] = [];
    const deps = {
      ...liveDeps(createAdminSupabase(), async (userIds) => {
        reached.push(...userIds);
        return { sent: userIds.length, skipped: 0, people: userIds.length };
      }),
      maintenance: async () => false,
      record: async () => undefined,
    };
    await attempt("Promemoria formazioni: ogni squadra una volta sola", async () => {
      await runLineupReminder(REMINDER_AT, deps);
      await runLineupReminder(REMINDER_AT + 5 * 60_000, deps);
      return reached.length === TEAMS && new Set(reached).size === TEAMS && fake.tables.engagement_notices.length === TEAMS
        ? "" : `${reached.length} invii, ${new Set(reached).size} persone, ${fake.tables.engagement_notices.length} segnate`;
    });

    await attempt("Leghe pubbliche: a pagine, senza le proprie", async () => {
      const first = await listPublicLeagues(userId(0));
      const second = await listPublicLeagues(userId(0), undefined, { offset: first.next ?? 0 });
      const third = await listPublicLeagues(userId(0), undefined, { offset: second.next ?? 0 });
      const names = [...first.leagues, ...second.leagues, ...third.leagues].map((league) => league.name);
      return names.length === PUBLIC - 1 && new Set(names).size === names.length && !names.includes("Lega 000") && third.next === null
        ? "" : `${names.length} leghe, ultima pagina ${third.next}`;
    });
    await attempt("Leghe pubbliche: ricerca per nome", async () => {
      const found = await listPublicLeagues(userId(0), undefined, { search: "lega 04" });
      const odd = await listPublicLeagues(userId(0), undefined, { search: "%" });
      return found.leagues.map((league) => league.name).join() === "Lega 040,Lega 041,Lega 042,Lega 043,Lega 044" && odd.leagues.length === 0
        ? "" : `${found.leagues.length} trovate, ${odd.leagues.length} con %`;
    });

    await attempt("Albo d'oro: una pagina per volta, prima le proprie leghe", async () => {
      const first = await loadHallOfFame({ userId: userId(0) });
      const last = await loadHallOfFame({ userId: userId(0), page: 3 });
      const searched = await loadHallOfFame({ search: "vecchia 1" });
      const names = (board: typeof first) => board.seasons[0].leagues.map((league) => league.leagueName);
      return names(first).length === 11 && names(first)[0] === "Vecchia 24" && first.more
        && names(last).length === 4 && !last.more && names(searched).length === 10
        ? "" : `${names(first).length}/${names(first)[0]}, ${names(last).length}, ${names(searched).length}`;
    });
  } finally {
    await fake.stop();
  }
  return { total, passed: total - failures.length, failures };
}

runLargeSiteChecks().then((result) => {
  console.log(`Sito grande: ${result.failures.length === 0 ? "PASSED" : "FAILED"} ${result.passed}/${result.total}`);
  for (const failure of result.failures) console.log(`- ${failure}`);
  process.exit(result.failures.length === 0 ? 0 : 1);
}).catch((error: unknown) => {
  console.log(`Sito grande: FAILED 0/1`);
  console.log(`- ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
