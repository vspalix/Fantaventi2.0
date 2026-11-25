import { cookies } from "next/headers";
import { headToHeadPairings, weekScoreMode, fantapuntiToGoals } from "@/lib/league-rules";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { getCurrentSeason } from "@/lib/server/catalog";
import { readLeagueSettings } from "@/lib/server/league-settings";
import { fantasyPointsForLeague } from "@/lib/server/league-scores";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { loadHomePromo, type HomePromo } from "@/lib/server/home-promo";
import { readSponsors } from "@/lib/server/sponsors";
import { readTeamLook } from "@/lib/server/team-look";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type HomeFixture = {
  id: string;
  kickoffAt: string;
  home: string;
  away: string;
  status: string;
};

export type HomeRoundDot = {
  number: number;
  points: number;
  average: number;
  tone: "up" | "mid" | "down";
  otherPoints: number | null;
};

export type HomeInsight = {
  badge: string;
  tone: "up" | "mid" | "down" | "rank" | "peak";
  text: string;
};

export type HomeLeagueCard = {
  id: string;
  name: string;
  format: string;
  rank: number | null;
  total: number | null;
  played: number;
  nextLabel: string | null;
  nextRival: string | null;
  average: number | null;
  lastRound: { number: number; points: number; average: number; otherName: string | null; otherPoints: number | null } | null;
  recent: HomeRoundDot[];
  insights: HomeInsight[];
};

export type HomeBoard = {
  competitionName: string;
  teamId: string | null;
  teamName: string;
  teamPrimary: string;
  teamSecondary: string;
  teamLogoUrl: string;
  sponsors: { scrollSeconds: number; items: { id: string; label: string; imageUrl: string; href: string }[] };
  deadlineAt: string | null;
  deadlineLabel: string | null;
  fixtures: HomeFixture[];
  leagues: HomeLeagueCard[];
  focus: HomeLeagueCard | null;
  promo: HomePromo | null;
  probabiliHref: string;
};

function clubLabel(row: { code?: string; club_translations?: { locale: string; short_name: string; name: string }[] | null }) {
  const translations = row.club_translations ?? [];
  const label = translations.find((item) => item.locale === "it") ?? translations[0];
  return label?.short_name || label?.name || row.code || "Club";
}

export async function loadHomeBoard(userId: string): Promise<HomeBoard> {
  const admin = createAdminSupabase();
  const season = await getCurrentSeason(admin);
  const leagues = await listLeaguesForUser(userId);
  const promo = await loadHomePromo();
  const saved = (await cookies()).get(LEAGUE_FOCUS_COOKIE)?.value ?? null;

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
      .select("id, kickoff_at, status, home_club_id, away_club_id, gameweek_id")
      .in("gameweek_id", weekIds)
      .gte("kickoff_at", new Date(now).toISOString())
      .order("kickoff_at", { ascending: true });
    const nextWeekId = matches.data?.[0]?.gameweek_id;
    const round = (matches.data ?? []).filter((match) => match.gameweek_id === nextWeekId);
    if (!matches.error && round.length > 0) {
      const clubIds = [...new Set(round.flatMap((match) => [match.home_club_id as string, match.away_club_id as string]))];
      const clubs = await admin.from("clubs").select("id, code, club_translations(locale, short_name, name)").in("id", clubIds);
      const names = new Map((clubs.data ?? []).map((club) => [club.id as string, clubLabel(club as { code?: string; club_translations?: { locale: string; short_name: string; name: string }[] })]));
      fixtures = round.map((match) => ({
        id: match.id as string,
        kickoffAt: match.kickoff_at as string,
        home: names.get(match.home_club_id as string) ?? "Casa",
        away: names.get(match.away_club_id as string) ?? "Trasferta",
        status: match.status as string,
      }));
    }
  }

  const cards: HomeLeagueCard[] = [];
  for (const league of leagues) {
    cards.push(await leagueCard(admin, season.id, league.id, league.name, league.teamId, calendar));
  }

  const focus = cards.find((card) => card.id === saved) ?? cards[0] ?? null;
  const focusLeague = leagues.find((league) => league.id === focus?.id) ?? null;
  const look = await readTeamLook(focusLeague?.teamId ?? null, focusLeague?.teamName || "La tua squadra");
  const sponsors = await readSponsors();
  return {
    competitionName: season.competitionName,
    teamId: focusLeague?.teamId ?? null,
    teamName: look.name,
    teamPrimary: look.primary,
    teamSecondary: look.secondary,
    teamLogoUrl: look.logoUrl,
    sponsors,
    deadlineAt: nextWeek ? nextWeek.deadline_at as string : null,
    deadlineLabel: nextWeek ? `Giornata ${nextWeek.number}` : null,
    fixtures,
    leagues: cards,
    focus,
    promo: promo.banner,
    probabiliHref: promo.probabiliHref,
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
    nextRival: null,
    average: null,
    lastRound: null,
    recent: [],
    insights: [],
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
    const trail: { number: number; points: number; average: number; place: number; otherName: string | null; otherPoints: number | null }[] = [];
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
      if (myTeamId) {
        const mine = weekPoints.get(myTeamId) ?? 0;
        const sum = [...weekPoints.values()].reduce((acc, value) => acc + value, 0);
        const weekAverage = teamIds.length ? sum / teamIds.length : 0;
        const ordered = [...totals.entries()].sort((left, right) => right[1] - left[1]);
        const spot = ordered.findIndex(([teamId]) => teamId === myTeamId);
        let otherName: string | null = null;
        let otherPoints: number | null = null;
        if (mode === "head_to_head") {
          const { pairs, bye } = headToHeadPairings(teamIds, Number(week.number));
          if (bye === myTeamId) otherName = "Riposo";
          const pair = pairs.find((item) => item.home === myTeamId || item.away === myTeamId);
          if (pair) {
            const otherId = pair.home === myTeamId ? pair.away : pair.home;
            otherName = teams.find((item) => item.id === otherId)?.name ?? "Avversario";
            otherPoints = Math.round((weekPoints.get(otherId) ?? 0) * 100) / 100;
          }
        }
        trail.push({
          number: Number(week.number),
          points: Math.round(mine * 100) / 100,
          average: Math.round(weekAverage * 100) / 100,
          place: spot + 1,
          otherName,
          otherPoints,
        });
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
    let nextRival: string | null = null;
    if (upcoming && myTeamId && weekScoreMode(settings.rules, Number(upcoming.number)) === "head_to_head") {
      const { pairs, bye } = headToHeadPairings(teamIds, Number(upcoming.number));
      if (bye === myTeamId) {
        nextRival = "Riposo";
        nextLabel = `Giornata ${upcoming.number}: riposo`;
      }
      const pair = pairs.find((item) => item.home === myTeamId || item.away === myTeamId);
      if (pair) {
        const opponentId = pair.home === myTeamId ? pair.away : pair.home;
        const opponent = teams.find((item) => item.id === opponentId)?.name ?? "Avversario";
        nextRival = opponent;
        nextLabel = `Giornata ${upcoming.number} contro ${opponent}`;
      }
    }
    const total = place >= 0 ? Math.round((totals.get(myTeamId as string) ?? 0) * 100) / 100 : null;
    const rank = place >= 0 ? place + 1 : null;
    const last = trail.at(-1) ?? null;
    const before = trail.at(-2) ?? null;
    const insights = storyOf(rank, total, trail, last, before);
    return {
      id: leagueId,
      name: leagueName,
      format: settings.rules.format,
      rank,
      total,
      played: counted.length,
      nextLabel,
      nextRival,
      average: total != null && counted.length > 0 ? Math.round((total / counted.length) * 100) / 100 : null,
      lastRound: last ? { number: last.number, points: last.points, average: last.average, otherName: last.otherName, otherPoints: last.otherPoints } : null,
      recent: trail.slice(-5).map((row) => ({
        number: row.number,
        points: row.points,
        average: row.average,
        tone: roundTone(row.points, row.average),
        otherPoints: row.otherPoints,
      })),
      insights,
    };
  } catch {
    return empty;
  }
}

function pointsText(value: number) {
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function roundTone(points: number, average: number): "up" | "mid" | "down" {
  if (Math.abs(points - average) < 1) return "mid";
  return points > average ? "up" : "down";
}

function storyOf(
  rank: number | null,
  total: number | null,
  trail: { number: number; points: number; average: number; place: number }[],
  last: { number: number; points: number; average: number; place: number } | null,
  before: { place: number } | null,
): HomeInsight[] {
  const lines: HomeInsight[] = [];
  if (rank != null && total != null) lines.push({ badge: "Classifica", tone: "rank", text: `Sei ${rank}° con ${pointsText(total)} punti.` });
  if (last && before && last.place < before.place) {
    const gained = before.place - last.place;
    lines.push({ badge: "Salita", tone: "up", text: `Nell'ultima giornata hai guadagnato ${gained} posizion${gained === 1 ? "e" : "i"}.` });
  } else if (last && before && last.place > before.place) {
    const lost = last.place - before.place;
    lines.push({ badge: "Discesa", tone: "down", text: `Nell'ultima giornata hai perso ${lost} posizion${lost === 1 ? "e" : "i"}.` });
  }
  if (last) {
    const tone = roundTone(last.points, last.average);
    const relation = tone === "up" ? "sopra la media" : tone === "down" ? "sotto la media" : "in linea con la media";
    lines.push({
      badge: tone === "up" ? "Sopra" : tone === "down" ? "Sotto" : "In media",
      tone,
      text: `Giornata ${last.number}: ${pointsText(last.points)} punti, ${relation} di giornata (${pointsText(last.average)}).`,
    });
  }
  if (trail.length >= 2) {
    const peak = trail.reduce((best, row) => row.points > best.points ? row : best, trail[0]);
    lines.push({ badge: "Picco", tone: "peak", text: `Il picco recente è ${pointsText(peak.points)} punti, giornata ${peak.number}.` });
  }
  return lines.slice(0, 4);
}
