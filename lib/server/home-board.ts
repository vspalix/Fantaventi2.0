import { headToHeadPairings, weekScoreMode, fantapuntiToGoals } from "@/lib/league-rules";
import { getCurrentSeason, getFantasyTeam } from "@/lib/server/catalog";
import { readLeagueSettings } from "@/lib/server/league-settings";
import { fantasyPointsForLeague } from "@/lib/server/league-scores";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { listPublishedNews, type PlatformNews } from "@/lib/server/news";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type HomeFixture = {
  id: string;
  kickoffAt: string;
  home: string;
  away: string;
  status: string;
};

export type HomeLeagueCard = {
  id: string;
  name: string;
  format: string;
  rank: number | null;
  total: number | null;
  played: number;
  nextLabel: string | null;
};

export type HomeBoard = {
  competitionName: string;
  deadlineAt: string | null;
  deadlineLabel: string | null;
  fixtures: HomeFixture[];
  leagues: HomeLeagueCard[];
  news: PlatformNews[];
};

function clubLabel(row: { code?: string; club_translations?: { locale: string; short_name: string; name: string }[] | null }) {
  const translations = row.club_translations ?? [];
  const label = translations.find((item) => item.locale === "it") ?? translations[0];
  return label?.short_name || label?.name || row.code || "Club";
}

export async function loadHomeBoard(userId: string): Promise<HomeBoard> {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const team = await getFantasyTeam(admin, userId, season.id);
  const leagues = await listLeaguesForUser(userId);
  const news = await listPublishedNews();

  const weeks = await admin
    .from("gameweeks")
    .select("id, number, deadline_at, status")
    .eq("season_id", season.id)
    .gte("number", 1)
    .lte("number", 38)
    .order("number", { ascending: true });
  if (weeks.error) throw new Error(weeks.error.message);
  const calendar = weeks.data ?? [];
  const now = Date.now();
  const nextWeek = calendar.find((week) => (
    week.status !== "scored"
    && week.status !== "final"
    && new Date(week.deadline_at as string).getTime() > now
  ));

  const weekIds = calendar.map((week) => week.id as string);
  let fixtures: HomeFixture[] = [];
  if (weekIds.length > 0) {
    const matches = await admin
      .from("real_matches")
      .select("id, kickoff_at, status, home_club_id, away_club_id")
      .in("gameweek_id", weekIds)
      .gte("kickoff_at", new Date(now).toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(6);
    if (!matches.error && (matches.data ?? []).length > 0) {
      const clubIds = [...new Set((matches.data ?? []).flatMap((match) => [match.home_club_id as string, match.away_club_id as string]))];
      const clubs = await admin.from("clubs").select("id, code, club_translations(locale, short_name, name)").in("id", clubIds);
      const names = new Map((clubs.data ?? []).map((club) => [club.id as string, clubLabel(club as { code?: string; club_translations?: { locale: string; short_name: string; name: string }[] })]));
      fixtures = (matches.data ?? []).map((match) => ({
        id: match.id as string,
        kickoffAt: match.kickoff_at as string,
        home: names.get(match.home_club_id as string) ?? "Casa",
        away: names.get(match.away_club_id as string) ?? "Trasferta",
        status: match.status as string,
      }));
    }
  }

  const cards: HomeLeagueCard[] = [];
  for (const league of leagues.slice(0, 4)) {
    cards.push(await leagueCard(admin, season.id, league.id, league.name, team?.id ?? null, calendar));
  }

  return {
    competitionName: season.competitionName,
    deadlineAt: nextWeek ? nextWeek.deadline_at as string : null,
    deadlineLabel: nextWeek ? `Giornata ${nextWeek.number}` : null,
    fixtures,
    leagues: cards,
    news,
  };
}

async function leagueCard(
  admin: ReturnType<typeof createAdminSupabase>,
  seasonId: string,
  leagueId: string,
  leagueName: string,
  myTeamId: string | null,
  calendar: { id: string; number: number; deadline_at: string; status: string }[],
): Promise<HomeLeagueCard> {
  const empty: HomeLeagueCard = {
    id: leagueId,
    name: leagueName,
    format: "classic",
    rank: null,
    total: null,
    played: 0,
    nextLabel: null,
  };
  try {
    const settings = await readLeagueSettings(admin, leagueId);
    const members = await admin
      .from("private_league_members")
      .select("fantasy_team_id, fantasy_teams(name)")
      .eq("private_league_id", leagueId);
    if (members.error) return empty;
    const teams = (members.data ?? []).map((row) => {
      const fantasy = Array.isArray(row.fantasy_teams) ? row.fantasy_teams[0] : row.fantasy_teams;
      return {
        id: row.fantasy_team_id as string,
        name: (fantasy as { name?: string } | null)?.name ?? "Squadra",
      };
    });
    const teamIds = teams.map((item) => item.id);
    const scored = calendar.filter((week) => week.status === "scored" || week.status === "final");
    const counted = scored.filter((week) => weekScoreMode(settings.rules, Number(week.number)) !== "knockout");
    const fantasy = await fantasyPointsForLeague(
      leagueId,
      seasonId,
      teamIds,
      counted.map((week) => ({ id: week.id as string, number: Number(week.number) })),
    );
    const totals = new Map<string, number>();
    for (const teamId of teamIds) totals.set(teamId, 0);
    for (const week of counted) {
      const mode = weekScoreMode(settings.rules, Number(week.number));
      const weekPoints = new Map(teamIds.map((teamId) => [teamId, fantasy.get(`${teamId}:${week.id}`) ?? 0]));
      if (mode === "head_to_head") {
        const goals = new Map([...weekPoints.entries()].map(([teamId, points]) => [
          teamId,
          settings.rules.goalBands.length > 0 ? fantapuntiToGoals(points, settings.rules.goalBands) : points,
        ]));
        const { pairs, bye } = headToHeadPairings(teamIds, Number(week.number));
        for (const pair of pairs) {
          const home = goals.get(pair.home) ?? 0;
          const away = goals.get(pair.away) ?? 0;
          const homePoints = home === away ? 1 : home > away ? 3 : 0;
          const awayPoints = home === away ? 1 : away > home ? 3 : 0;
          totals.set(pair.home, (totals.get(pair.home) ?? 0) + homePoints);
          totals.set(pair.away, (totals.get(pair.away) ?? 0) + awayPoints);
        }
        if (bye) totals.set(bye, (totals.get(bye) ?? 0) + 3);
      } else {
        for (const [teamId, points] of weekPoints) totals.set(teamId, (totals.get(teamId) ?? 0) + points);
      }
    }
    const ranking = [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const place = myTeamId ? ranking.findIndex(([teamId]) => teamId === myTeamId) : -1;
    const upcoming = calendar.find((week) => (
      week.status !== "scored"
      && week.status !== "final"
      && new Date(week.deadline_at).getTime() > Date.now()
    ));
    let nextLabel: string | null = upcoming ? `Prossima: giornata ${upcoming.number}` : null;
    if (upcoming && myTeamId && weekScoreMode(settings.rules, Number(upcoming.number)) === "head_to_head") {
      const { pairs, bye } = headToHeadPairings(teamIds, Number(upcoming.number));
      if (bye === myTeamId) nextLabel = `Giornata ${upcoming.number}: riposo`;
      const pair = pairs.find((item) => item.home === myTeamId || item.away === myTeamId);
      if (pair) {
        const opponentId = pair.home === myTeamId ? pair.away : pair.home;
        const opponent = teams.find((item) => item.id === opponentId)?.name ?? "avversario";
        nextLabel = `Giornata ${upcoming.number} contro ${opponent}`;
      }
    }
    return {
      id: leagueId,
      name: leagueName,
      format: settings.rules.format,
      rank: place >= 0 ? place + 1 : null,
      total: place >= 0 ? Math.round((totals.get(myTeamId as string) ?? 0) * 100) / 100 : null,
      played: counted.length,
      nextLabel,
    };
  } catch {
    return empty;
  }
}
