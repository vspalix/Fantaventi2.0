import { createHash, randomUUID } from "node:crypto";
import { fetchFantacalcioMatchweek, votesForClubs, type FantacalcioPlayerVote } from "@/lib/server/fantacalcio-live";
import { MATCH_CLOSE_MS } from "@/lib/server/match-window";
import { schemaHint, scoreOfficialGameweek, refreshProvisionalScores, persistLiveProjection } from "@/lib/server/live-score";
import type { PlayerStat } from "@/lib/engine/calculator";
import { createAdminSupabase } from "@/lib/supabase/admin";

const SOURCE = "fantacalcio-live";

type MatchRow = {
  id: string;
  gameweek_id: string;
  kickoff_at: string;
  status: string;
  home_club_id: string;
  away_club_id: string;
};

type GameweekRow = {
  id: string;
  number: number;
  status: string;
  season_id: string;
};

type StoredStat = {
  id: string;
  player_id: string;
  voto: number | null;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  penalties_scored: number;
  penalties_missed: number;
  penalties_saved: number;
  own_goals: number;
  goals_conceded: number;
};

export type MatchVoteSyncResult = {
  synced: { gameweekNumber: number; matchId: string; players: number }[];
  waiting: { gameweekNumber: number; matchId: string; reason: string }[];
  projected: number[];
  audited: number[];
  scored: number[];
  skipped: { gameweekNumber: number; reason: string }[];
  errors: { gameweekNumber: number | null; matchId: string | null; message: string }[];
};

function digest(matchId: string, votes: FantacalcioPlayerVote[]) {
  const body = votes
    .map((vote) => [
      vote.externalRef,
      vote.voto,
      vote.goals,
      vote.assists,
      vote.yellowCards,
      vote.redCards,
      vote.penaltiesScored,
      vote.penaltiesMissed,
      vote.penaltiesSaved,
      vote.ownGoals,
      vote.goalsConceded,
    ].join(":"))
    .sort()
    .join("|");
  return createHash("sha256").update(`${matchId}|${body}`).digest("hex");
}

function sameStat(stored: StoredStat, vote: FantacalcioPlayerVote) {
  return Number(stored.voto) === vote.voto
    && stored.goals === vote.goals
    && stored.assists === vote.assists
    && stored.yellow_cards === vote.yellowCards
    && stored.red_cards === vote.redCards
    && stored.penalties_scored === vote.penaltiesScored
    && stored.penalties_missed === vote.penaltiesMissed
    && stored.penalties_saved === vote.penaltiesSaved
    && stored.own_goals === vote.ownGoals
    && stored.goals_conceded === vote.goalsConceded;
}

export async function syncDueMatchVotes(now = new Date()): Promise<MatchVoteSyncResult> {
  const admin = createAdminSupabase();
  const result: MatchVoteSyncResult = { synced: [], waiting: [], projected: [], audited: [], scored: [], skipped: [], errors: [] };
  const seasons = await admin
    .from("seasons")
    .select("id, code, competitions!inner(code)");
  if (seasons.error) throw new Error(seasons.error.message);
  const seasonCode = new Map<string, string>();
  const competitionCode = new Map<string, string>();
  for (const season of seasons.data ?? []) {
    const competition = Array.isArray(season.competitions) ? season.competitions[0] : season.competitions;
    seasonCode.set(season.id as string, season.code as string);
    competitionCode.set(season.id as string, String(competition?.code ?? ""));
  }
  const seasonIds = [...seasonCode.keys()];
  if (seasonIds.length === 0) return result;

  const weeks = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .in("season_id", seasonIds);
  if (weeks.error) throw new Error(weeks.error.message);
  const gameweeks = (weeks.data ?? []) as GameweekRow[];
  const openWeeks = gameweeks.filter((week) => week.status !== "final" && week.status !== "scored");
  if (openWeeks.length === 0) return result;

  const matches = await admin
    .from("real_matches")
    .select("id, gameweek_id, kickoff_at, status, home_club_id, away_club_id")
    .in("gameweek_id", openWeeks.map((week) => week.id));
  if (matches.error) throw new Error(schemaHint(matches.error.message));
  const rows = (matches.data ?? []) as MatchRow[];
  const clubIds = [...new Set(rows.flatMap((match) => [match.home_club_id, match.away_club_id]))];
  const clubs = clubIds.length
    ? await admin.from("clubs").select("id, code").in("id", clubIds)
    : { data: [], error: null };
  if (clubs.error) throw new Error(clubs.error.message);
  const clubCode = new Map((clubs.data ?? []).map((club) => [club.id as string, (club.code as string).toLowerCase()]));

  const pageCache = new Map<string, Awaited<ReturnType<typeof fetchFantacalcioMatchweek>>>();
  async function pageFor(week: GameweekRow, fresh = false) {
    const key = `${week.season_id}:${week.number}`;
    if (fresh) pageCache.delete(key);
    const cached = pageCache.get(key);
    if (cached) return cached;
    const loaded = await fetchFantacalcioMatchweek(seasonCode.get(week.season_id) ?? "", week.number);
    pageCache.set(key, loaded);
    return loaded;
  }

  const byWeek = new Map<string, MatchRow[]>();
  for (const match of rows) {
    const list = byWeek.get(match.gameweek_id) ?? [];
    list.push(match);
    byWeek.set(match.gameweek_id, list);
  }

  for (const week of openWeeks) {
    const weekMatches = byWeek.get(week.id) ?? [];
    if (weekMatches.length === 0) continue;
    if (competitionCode.get(week.season_id) !== "serie_a") {
      result.skipped.push({
        gameweekNumber: week.number,
        reason: "La fonte automatica dei voti vale per serie_a. Le altre competizioni si chiudono con il file di emergenza.",
      });
      continue;
    }
    const underway = weekMatches.filter((match) => (
      match.status !== "finished"
      && now.getTime() >= new Date(match.kickoff_at).getTime()
      && now.getTime() < new Date(match.kickoff_at).getTime() + MATCH_CLOSE_MS
    ));
    if (underway.length > 0) {
      try {
        const page = await pageFor(week);
        if (page.votes.length > 0) {
          await projectPublishedVotes(admin, week.id, page.votes);
          if (!result.projected.includes(week.number)) result.projected.push(week.number);
        }
      } catch (error) {
        result.errors.push({
          gameweekNumber: week.number,
          matchId: null,
          message: error instanceof Error ? error.message : "Proiezione live non aggiornata.",
        });
      }
    }

    const due = weekMatches.filter((match) => (
      match.status !== "finished" && now.getTime() >= new Date(match.kickoff_at).getTime() + MATCH_CLOSE_MS
    ));
    for (const match of due) {
      const othersOpen = weekMatches.some((item) => item.id !== match.id && item.status !== "finished");
      try {
        const page = await pageFor(week);
        const home = clubCode.get(match.home_club_id) ?? "";
        const away = clubCode.get(match.away_club_id) ?? "";
        const votes = votesForClubs(page.votes, home, away);
        if (votes.length === 0) {
          result.waiting.push({
            gameweekNumber: week.number,
            matchId: match.id,
            reason: "I voti di questa partita non sono ancora pubblicati.",
          });
          continue;
        }
        const written = await writeMatchVotes(admin, week.id, match, votes, false);
        if (written === 0) {
          result.waiting.push({
            gameweekNumber: week.number,
            matchId: match.id,
            reason: "I codici del tabellino non sono nel listone.",
          });
          continue;
        }
        const score = page.scores.find((item) => item.homeSlug === home && item.awaySlug === away);
        if (score && score.homeGoals !== null && score.awayGoals !== null) {
          const goals = await admin.from("real_matches").update({
            home_goals: score.homeGoals,
            away_goals: score.awayGoals,
          }).eq("id", match.id);
          if (goals.error && !/home_goals|away_goals/i.test(goals.error.message)) {
            throw new Error(schemaHint(goals.error.message));
          }
        }
        if (!othersOpen) {
          await auditWeek(admin, week, weekMatches, clubCode, await pageFor(week, true));
          result.audited.push(week.number);
          await markFinished(admin, match.id);
          match.status = "finished";
          await closeWeek(admin, week, result);
        } else {
          await markFinished(admin, match.id);
          match.status = "finished";
        }
        try {
          await refreshProvisionalScores(week.id);
        } catch (error) {
          result.errors.push({
            gameweekNumber: week.number,
            matchId: match.id,
            message: error instanceof Error ? error.message : "Punteggio live non aggiornato.",
          });
        }
        result.synced.push({ gameweekNumber: week.number, matchId: match.id, players: written });
      } catch (error) {
        result.errors.push({
          gameweekNumber: week.number,
          matchId: match.id,
          message: error instanceof Error ? error.message : "Sincronizzazione non riuscita.",
        });
      }
    }

    const stillOpen = (byWeek.get(week.id) ?? []).some((match) => match.status !== "finished");
    const liveImports = await admin
      .from("vote_imports")
      .select("id", { count: "exact", head: true })
      .eq("gameweek_id", week.id)
      .eq("source", SOURCE);
    if (liveImports.error) throw new Error(liveImports.error.message);
    if (!stillOpen && (liveImports.count ?? 0) > 0 && week.status !== "scored" && week.status !== "final" && !result.scored.includes(week.number)) {
      try {
        await auditWeek(admin, week, weekMatches, clubCode, await pageFor(week, true));
        result.audited.push(week.number);
        await closeWeek(admin, week, result);
      } catch (error) {
        result.errors.push({
          gameweekNumber: week.number,
          matchId: null,
          message: error instanceof Error ? error.message : "Chiusura giornata non riuscita.",
        });
      }
    }
  }

  return result;
}

async function projectPublishedVotes(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  votes: FantacalcioPlayerVote[],
) {
  const refs = [...new Set(votes.map((vote) => vote.externalRef))];
  const players = await admin.from("players").select("id, external_ref").in("external_ref", refs);
  if (players.error) throw new Error(players.error.message);
  const playerId = new Map((players.data ?? []).map((player) => [player.external_ref as string, player.id as string]));
  const overlay = new Map<string, PlayerStat>();
  for (const vote of votes) {
    const id = playerId.get(vote.externalRef);
    if (!id) continue;
    overlay.set(id, {
      playerId: id,
      role: "MID",
      voto: vote.voto,
      goals: vote.goals,
      assists: vote.assists,
      yellowCards: vote.yellowCards,
      redCards: vote.redCards,
      penaltiesScored: vote.penaltiesScored,
      penaltiesMissed: vote.penaltiesMissed,
      penaltiesSaved: vote.penaltiesSaved,
      ownGoals: vote.ownGoals,
      goalsConceded: vote.goalsConceded,
      postponed: false,
      withoutVote: vote.voto === null,
    });
  }
  if (overlay.size === 0) return;
  await persistLiveProjection(gameweekId, overlay);
}

async function markFinished(admin: ReturnType<typeof createAdminSupabase>, matchId: string) {
  const { error } = await admin.from("real_matches").update({ status: "finished" }).eq("id", matchId);
  if (error) throw new Error(schemaHint(error.message));
}

async function writeMatchVotes(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  match: MatchRow,
  votes: FantacalcioPlayerVote[],
  onlyChanges: boolean,
) {
  const note = `match:${match.id}`;
  const hash = digest(match.id, votes);
  const existingImport = await admin
    .from("vote_imports")
    .select("id, payload_hash")
    .eq("gameweek_id", gameweekId)
    .eq("source", SOURCE)
    .eq("source_note", note)
    .maybeSingle();
  if (existingImport.error) throw new Error(existingImport.error.message);
  const importId = (existingImport.data?.id as string | undefined) ?? randomUUID();
  const hashMatches = existingImport.data?.payload_hash === hash;
  if (hashMatches && onlyChanges) return votes.length;

  const refs = votes.map((vote) => vote.externalRef);
  const players = await admin.from("players").select("id, external_ref").in("external_ref", refs);
  if (players.error) throw new Error(players.error.message);
  const playerId = new Map((players.data ?? []).map((player) => [player.external_ref as string, player.id as string]));
  const known = votes.filter((vote) => playerId.has(vote.externalRef));
  if (known.length === 0) return 0;
  if (!existingImport.data) {
    const { error } = await admin.from("vote_imports").insert({
      id: importId,
      gameweek_id: gameweekId,
      source: SOURCE,
      source_note: note,
      payload_hash: `pending:${importId}`,
    });
    if (error) throw new Error(schemaHint(error.message));
  }
  const ids = known.map((vote) => playerId.get(vote.externalRef) as string);
  const stored = await admin
    .from("player_gameweek_stats")
    .select("id, player_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals, goals_conceded")
    .eq("gameweek_id", gameweekId)
    .in("player_id", ids);
  if (stored.error) throw new Error(stored.error.message);
  const current = new Map(((stored.data ?? []) as StoredStat[]).map((row) => [row.player_id, row]));
  const changed = known.filter((vote) => {
    const row = current.get(playerId.get(vote.externalRef) as string);
    return !row || !sameStat(row, vote);
  });
  const writing = onlyChanges ? changed : known;
  if (writing.length > 0) {
    const { error } = await admin.from("player_gameweek_stats").upsert(writing.map((vote) => {
      const id = playerId.get(vote.externalRef) as string;
      return {
        id: current.get(id)?.id ?? randomUUID(),
        gameweek_id: gameweekId,
        player_id: id,
        vote_import_id: importId,
        voto: vote.voto,
        goals: vote.goals,
        assists: vote.assists,
        yellow_cards: vote.yellowCards,
        red_cards: vote.redCards,
        penalties_scored: vote.penaltiesScored,
        penalties_missed: vote.penaltiesMissed,
        penalties_saved: vote.penaltiesSaved,
        own_goals: vote.ownGoals,
        goals_conceded: vote.goalsConceded,
      };
    }), { onConflict: "gameweek_id,player_id" });
    if (error) throw new Error(schemaHint(error.message));
  }
  if (!hashMatches) {
    const sealed = await admin.from("vote_imports").update({ payload_hash: hash }).eq("id", importId);
    if (sealed.error) throw new Error(schemaHint(sealed.error.message));
  }
  if (!onlyChanges) return known.length;

  const owned = await admin
    .from("player_gameweek_stats")
    .select("id, player_id, voto")
    .eq("vote_import_id", importId);
  if (owned.error) throw new Error(owned.error.message);
  const keep = new Set(ids);
  const dropped = (owned.data ?? []).filter((row) => !keep.has(row.player_id as string) && row.voto !== null);
  if (dropped.length === 0) return known.length;
  const cleared = await admin
    .from("player_gameweek_stats")
    .update({ voto: null })
    .in("id", dropped.map((row) => row.id as string));
  if (cleared.error) throw new Error(schemaHint(cleared.error.message));
  return known.length;
}

async function auditWeek(
  admin: ReturnType<typeof createAdminSupabase>,
  week: GameweekRow,
  matches: MatchRow[],
  clubCode: Map<string, string>,
  page: Awaited<ReturnType<typeof fetchFantacalcioMatchweek>>,
) {
  for (const match of matches) {
    const votes = votesForClubs(
      page.votes,
      clubCode.get(match.home_club_id) ?? "",
      clubCode.get(match.away_club_id) ?? "",
    );
    if (votes.length === 0) continue;
    await writeMatchVotes(admin, week.id, match, votes, true);
  }
}

async function closeWeek(
  admin: ReturnType<typeof createAdminSupabase>,
  week: GameweekRow,
  result: MatchVoteSyncResult,
) {
  if (result.scored.includes(week.number) || week.status === "scored" || week.status === "final") {
    result.skipped.push({ gameweekNumber: week.number, reason: "Giornata già calcolata." });
    return;
  }
  const outcome = await scoreOfficialGameweek(week.id);
  if (outcome.skipped) {
    result.skipped.push({ gameweekNumber: week.number, reason: outcome.reason ?? "Calcolo non rieseguito." });
    return;
  }
  const stamp = new Date().toISOString();
  let statusUpdate = await admin.from("gameweeks").update({ status: "scored", scored_at: stamp }).eq("id", week.id);
  if (statusUpdate.error && /scored_at/i.test(statusUpdate.error.message)) {
    statusUpdate = await admin.from("gameweeks").update({ status: "scored" }).eq("id", week.id);
  }
  if (statusUpdate.error) throw new Error(schemaHint(statusUpdate.error.message));
  const { error: lineupError } = await admin
    .from("lineups")
    .update({ status: "locked", locked_at: stamp })
    .eq("gameweek_id", week.id)
    .eq("status", "draft");
  if (lineupError) throw new Error(lineupError.message);
  week.status = "scored";
  result.scored.push(week.number);
}
