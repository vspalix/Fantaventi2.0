import { createHash, randomUUID } from "node:crypto";
import { fetchFantacalcioMatchweek, votesForClubs, type FantacalcioPlayerVote } from "@/lib/server/fantacalcio-live";
import { schemaHint, scoreOfficialGameweek, refreshProvisionalScores } from "@/lib/server/live-score";
import { saveProvisionalVotes, type ProvisionalVote } from "@/lib/server/provisional-votes";
import { refreshSerieAKickoffs } from "@/lib/server/kickoff-refresh";
import { reportError } from "@/lib/server/error-report";
import { readSystemSettings } from "@/lib/server/system-settings";
import { sendTelegramMessage } from "@/lib/server/telegram-alert";
import { voteReportText, type VoteReport } from "@/lib/server/vote-report";
import { runManualRead, runVoteCycle, type ClockDeps, type CycleReport, type VotePage } from "@/lib/server/vote-engine";
import { planVoteClock, type ClockSnapshot, type VotePlan } from "@/lib/server/vote-schedule";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type { MatchVoteSyncResult } from "@/lib/server/vote-engine";

const SOURCE = "fantacalcio-live";

type MatchRow = {
  id: string;
  gameweek_id: string;
  kickoff_at: string;
  status: string;
  home_club_id: string;
  away_club_id: string;
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

async function projectPublishedVotes(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  votes: FantacalcioPlayerVote[],
) {
  const refs = [...new Set(votes.map((vote) => vote.externalRef))];
  const players = await admin.from("players").select("id, external_ref").in("external_ref", refs);
  if (players.error) throw new Error(players.error.message);
  const playerId = new Map((players.data ?? []).map((player) => [player.external_ref as string, player.id as string]));
  const known: ProvisionalVote[] = [];
  for (const vote of votes) {
    const id = playerId.get(vote.externalRef);
    if (!id) continue;
    known.push({
      playerId: id,
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
    });
  }
  if (known.length === 0) return;
  // Prima si salvano i voti (le schermate leggono questi), poi i totali provvisori.
  await saveProvisionalVotes(gameweekId, known);
  await refreshProvisionalScores(gameweekId);
}

async function markFinished(admin: ReturnType<typeof createAdminSupabase>, matchId: string) {
  const { error } = await admin.from("real_matches").update({ status: "finished" }).eq("id", matchId);
  if (error) throw new Error(schemaHint(error.message));
}

async function writeMatchVotes(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  match: Pick<MatchRow, "id">,
  votes: FantacalcioPlayerVote[],
  onlyChanges: boolean,
  sink?: { samples: string[]; changed: number },
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
  if (sink && changed.length > 0) {
    sink.changed += changed.length;
    const room = 5 - sink.samples.length;
    if (room > 0) {
      const slice = changed.slice(0, room);
      const namedIds = slice.map((vote) => playerId.get(vote.externalRef) as string);
      const named = await admin.from("players").select("id, full_name").in("id", namedIds);
      const names = new Map((named.data ?? []).map((row) => [row.id as string, String(row.full_name ?? "")]));
      for (const vote of slice) {
        const id = playerId.get(vote.externalRef) as string;
        const name = names.get(id) || vote.externalRef;
        const mark = vote.voto == null ? "s.v." : String(vote.voto).replace(".", ",");
        sink.samples.push(`${name} ${mark}`);
      }
    }
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

export async function importPublishedWeekVotes(gameweekId: string) {
  const admin = createAdminSupabase();
  const week = await admin.from("gameweeks").select("id, number, season_id").eq("id", gameweekId).maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) throw new Error("Giornata non trovata.");
  const season = await admin.from("seasons").select("code").eq("id", week.data.season_id).maybeSingle();
  if (season.error) throw new Error(season.error.message);
  const matches = await admin
    .from("real_matches")
    .select("id, gameweek_id, kickoff_at, status, home_club_id, away_club_id")
    .eq("gameweek_id", gameweekId);
  if (matches.error) throw new Error(schemaHint(matches.error.message));
  const rows = (matches.data ?? []) as MatchRow[];
  const clubIds = [...new Set(rows.flatMap((match) => [match.home_club_id, match.away_club_id]))];
  const clubs = clubIds.length
    ? await admin.from("clubs").select("id, code").in("id", clubIds)
    : { data: [] as { id: string; code: string }[], error: null };
  if (clubs.error) throw new Error(clubs.error.message);
  const clubCode = new Map((clubs.data ?? []).map((club) => [club.id as string, String(club.code).toLowerCase()]));
  const page = await fetchFantacalcioMatchweek(String(season.data?.code ?? ""), Number(week.data.number));
  const realGrades = page.votes.filter((vote) => vote.voto !== null).length;
  let matchesWithVotes = 0;
  let players = 0;
  const missing: string[] = [];
  for (const match of rows) {
    const home = clubCode.get(match.home_club_id) ?? "";
    const away = clubCode.get(match.away_club_id) ?? "";
    const votes = votesForClubs(page.votes, home, away);
    const label = `${home || "?"}-${away || "?"}`;
    if (votes.length === 0) {
      missing.push(label);
      continue;
    }
    const written = await writeMatchVotes(admin, gameweekId, match, votes, false);
    if (written === 0) {
      missing.push(`${label} (non in listone)`);
      continue;
    }
    matchesWithVotes += 1;
    players += written;
  }
  return {
    realGrades,
    matches: rows.length,
    matchesWithVotes,
    players,
    missing,
  };
}

function voteMessage(message: string) {
  const safe = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return sendTelegramMessage(`<b>Fantaventi — voti</b>\n${safe}`);
}

/** L'avviso di controllo non ferma mai la lettura: se non riesce, si segnala e si va avanti. */
async function sendVoteReport(admin: ReturnType<typeof createAdminSupabase>, report: VoteReport) {
  try {
    const refs = [...new Set(report.matches.flatMap((match) => match.votes.map((vote) => vote.externalRef)))];
    if (refs.length === 0 || !(await readSystemSettings()).notifyOnSyncSuccess) return;
    const players = await admin.from("players").select("external_ref").in("external_ref", refs);
    if (players.error) throw new Error(players.error.message);
    const text = voteReportText(report, new Set((players.data ?? []).map((row) => row.external_ref as string)));
    if (text) await voteMessage(text);
  } catch (error) {
    void reportError("Avviso Telegram dei voti inseriti", error);
  }
}

/** L'unica lettura fatta quando la sveglia suona: impostazioni, partite recenti e tentativi. */
async function readClock(): Promise<ClockSnapshot> {
  const { data, error } = await createAdminSupabase().rpc("vote_clock");
  if (error) {
    if (/vote_clock|schema cache|could not find|does not exist/i.test(error.message)) {
      const missing = new Error("Esegui supabase/vote_schedule.sql nell'editor SQL di Supabase.");
      (missing as Error & { status: number }).status = 503;
      throw missing;
    }
    throw new Error(error.message);
  }
  return data as ClockSnapshot;
}

function clockDeps(): ClockDeps {
  const admin = createAdminSupabase();
  return {
    snapshot: readClock,
    async claim(target, attempt, now) {
      const { error } = await admin.from("vote_reads").insert({
        task_key: target.key,
        attempt,
        gameweek_id: target.weekId,
        kind: target.kind,
        outcome: attempt === 0 ? "alert" : "pending",
        started_at: new Date(now).toISOString(),
      });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(error.message);
    },
    async finish(key, attempt, outcome, detail) {
      const { error } = await admin
        .from("vote_reads")
        .update({ outcome, detail, finished_at: new Date().toISOString() })
        .eq("task_key", key)
        .eq("attempt", attempt);
      if (error) throw new Error(error.message);
    },
    fetchPage: (week) => fetchFantacalcioMatchweek(week.seasonCode, week.number),
    async lockWeek(week) {
      const stamp = new Date().toISOString();
      const status = await admin.from("gameweeks").update({ status: "locked" }).eq("id", week.id).in("status", ["scheduled", "open"]);
      if (status.error) throw new Error(schemaHint(status.error.message));
      const lineups = await admin.from("lineups").update({ status: "locked", locked_at: stamp }).eq("gameweek_id", week.id).eq("status", "draft");
      if (lineups.error) throw new Error(lineups.error.message);
    },
    writeProjection: (week, votes) => projectPublishedVotes(admin, week.id, votes),
    async writeOfficial(week, match, page: VotePage, sink) {
      const votes = votesForClubs(page.votes, match.home, match.away);
      const written = await writeMatchVotes(admin, week.id, { id: match.id }, votes, true, sink);
      if (written === 0) return 0;
      const score = page.scores.find((item) => item.homeSlug === match.home && item.awaySlug === match.away);
      if (score && score.homeGoals !== null && score.awayGoals !== null) {
        const goals = await admin.from("real_matches").update({
          home_goals: score.homeGoals,
          away_goals: score.awayGoals,
        }).eq("id", match.id);
        if (goals.error && !/home_goals|away_goals/i.test(goals.error.message)) throw new Error(schemaHint(goals.error.message));
      }
      await markFinished(admin, match.id);
      return written;
    },
    async releaseHold(match) {
      const { error } = await admin
        .from("real_matches")
        .update({ postponed: false, hold_status: "none", hold_kickoff_at: null })
        .eq("id", match.id);
      if (error) throw new Error(schemaHint(error.message));
    },
    async refreshProvisional(week) {
      await refreshProvisionalScores(week.id);
    },
    async calculate(week, rewrite) {
      const outcome = await scoreOfficialGameweek(week.id, rewrite ? { allowRewrite: true } : undefined);
      if (outcome.skipped) return { scored: false, reason: outcome.reason ?? undefined };
      if (rewrite) return { scored: true };
      const stamp = new Date().toISOString();
      let update = await admin.from("gameweeks").update({ status: "scored", scored_at: stamp }).eq("id", week.id);
      if (update.error && /scored_at/i.test(update.error.message)) {
        update = await admin.from("gameweeks").update({ status: "scored" }).eq("id", week.id);
      }
      if (update.error) throw new Error(schemaHint(update.error.message));
      const lineups = await admin.from("lineups").update({ status: "locked", locked_at: stamp }).eq("gameweek_id", week.id).eq("status", "draft");
      if (lineups.error) throw new Error(lineups.error.message);
      return { scored: true };
    },
    async refreshCalendar() {
      const outcome = await refreshSerieAKickoffs({ daily: true });
      return { changed: outcome.updated, warnings: outcome.warnings };
    },
    async notify(message) {
      await voteMessage(message);
    },
    reportVotes: (report) => sendVoteReport(admin, report),
    async reportScored(gameweek, rewrite) {
      await voteMessage(`Giornata ${gameweek} ${rewrite ? "ricalcolata" : "calcolata"}.`);
    },
  };
}

/** Decide cosa c'è da fare con una sola lettura, senza scrivere e senza contattare le fonti. */
export async function prepareVoteClock(now = new Date()) {
  const snapshot = await readClock();
  return { snapshot, plan: planVoteClock(snapshot, now.getTime()) };
}

export function runPlannedReads(snapshot: ClockSnapshot, plan: VotePlan, now = new Date()): Promise<CycleReport> {
  return runVoteCycle(clockDeps(), snapshot, plan, now.getTime());
}

/** Richiesta manuale di un super admin: contatta subito la fonte. */
export function syncDueMatchVotes(now = new Date()): Promise<CycleReport> {
  return runManualRead(clockDeps(), now.getTime());
}
