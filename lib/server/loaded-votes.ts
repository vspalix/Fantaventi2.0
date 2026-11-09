import { loadCatalog } from "@/lib/server/catalog";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { PlayerRole } from "@/lib/types";

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export type LoadedVoteFile = {
  id: string;
  source: string;
  fileName: string;
  importedAt: string;
  rows: number;
  rated: number;
};

export type LoadedVoteRow = {
  importId: string;
  playerId: string;
  playerName: string;
  role: PlayerRole;
  club: string;
  clubId: string;
  voto: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  penaltiesScored: number;
  penaltiesMissed: number;
  penaltiesSaved: number;
  ownGoals: number;
  goalsConceded: number;
  postponed: boolean;
};

export type LoadedVoteMatch = {
  id: string;
  home: string;
  away: string;
  homeClubId: string;
  awayClubId: string;
  homeVotes: number;
  awayVotes: number;
  votesLoaded: boolean;
};

const ROLE_ORDER: Record<PlayerRole, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export async function loadLoadedVotes(userId: string, gameweekId: string) {
  const admin = createAdminSupabase();
  const { data: gameweek, error: gameweekError } = await admin
    .from("gameweeks")
    .select("id, number, season_id")
    .eq("id", gameweekId)
    .maybeSingle();
  if (gameweekError) throw new Error(gameweekError.message);
  if (!gameweek) throw httpError("Giornata non trovata.", 404);

  const { data: owned, error: ownedError } = await admin
    .from("private_leagues")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("season_id", gameweek.season_id)
    .limit(1);
  if (ownedError) throw new Error(ownedError.message);
  if (!owned?.length) throw httpError("Solo il proprietario di una lega di questa stagione può leggere i voti caricati.", 403);

  const catalog = await loadCatalog(gameweek.season_id as string);
  const byId = new Map(catalog.players.map((player) => [player.id, player]));

  const { data: importRows, error: importError } = await admin
    .from("vote_imports")
    .select("id, source, source_note, imported_at")
    .eq("gameweek_id", gameweekId)
    .order("imported_at", { ascending: false });
  if (importError) throw new Error(importError.message);

  const extended = await admin
    .from("player_gameweek_stats")
    .select("player_id, vote_import_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals, goals_conceded, postponed")
    .eq("gameweek_id", gameweekId);
  const statsQuery = extended.error && /postponed/i.test(extended.error.message)
    ? await admin
      .from("player_gameweek_stats")
      .select("player_id, vote_import_id, voto, goals, assists, yellow_cards, red_cards, penalties_scored, penalties_missed, penalties_saved, own_goals, goals_conceded")
      .eq("gameweek_id", gameweekId)
    : extended;
  if (statsQuery.error) throw new Error(statsQuery.error.message);

  const votes: LoadedVoteRow[] = (statsQuery.data ?? []).map((row) => {
    const player = byId.get(row.player_id as string);
    const voto = row.voto === null || row.voto === undefined ? null : Number(row.voto);
    return {
      importId: row.vote_import_id as string,
      playerId: row.player_id as string,
      playerName: player?.fullName ?? "Calciatore",
      role: player?.role ?? "MID",
      club: player?.clubShort || player?.clubName || "—",
      clubId: player?.clubId ?? "",
      voto,
      goals: Number(row.goals ?? 0),
      assists: Number(row.assists ?? 0),
      yellowCards: Number(row.yellow_cards ?? 0),
      redCards: Number(row.red_cards ?? 0),
      penaltiesScored: Number(row.penalties_scored ?? 0),
      penaltiesMissed: Number(row.penalties_missed ?? 0),
      penaltiesSaved: Number(row.penalties_saved ?? 0),
      ownGoals: Number(row.own_goals ?? 0),
      goalsConceded: Number(row.goals_conceded ?? 0),
      postponed: Boolean((row as { postponed?: boolean }).postponed),
    };
  }).sort((left, right) => (
    left.club.localeCompare(right.club, "it")
    || ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
    || left.playerName.localeCompare(right.playerName, "it")
  ));

  const files: LoadedVoteFile[] = (importRows ?? []).map((row) => {
    const mine = votes.filter((vote) => vote.importId === row.id);
    return {
      id: row.id as string,
      source: (row.source as string) || "file",
      fileName: (row.source_note as string) || "File senza nome",
      importedAt: row.imported_at as string,
      rows: mine.length,
      rated: mine.filter((vote) => vote.voto !== null).length,
    };
  });

  const ratedByClub = new Map<string, number>();
  for (const vote of votes) {
    if (vote.voto === null || !vote.clubId) continue;
    ratedByClub.set(vote.clubId, (ratedByClub.get(vote.clubId) ?? 0) + 1);
  }

  const matchesQuery = await admin
    .from("real_matches")
    .select("id, home_club_id, away_club_id, kickoff_at")
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });
  if (matchesQuery.error && !/real_matches|schema cache|could not find/i.test(matchesQuery.error.message)) {
    throw new Error(matchesQuery.error.message);
  }
  const clubName = new Map(catalog.clubs.map((club) => [club.id, club.shortName || club.name]));
  const matches: LoadedVoteMatch[] = matchesQuery.error ? [] : (matchesQuery.data ?? []).map((row) => {
    const homeClubId = row.home_club_id as string;
    const awayClubId = row.away_club_id as string;
    const homeVotes = ratedByClub.get(homeClubId) ?? 0;
    const awayVotes = ratedByClub.get(awayClubId) ?? 0;
    return {
      id: row.id as string,
      home: clubName.get(homeClubId) ?? "Casa",
      away: clubName.get(awayClubId) ?? "Trasferta",
      homeClubId,
      awayClubId,
      homeVotes,
      awayVotes,
      votesLoaded: homeVotes + awayVotes > 0,
    };
  });

  return {
    gameweekNumber: gameweek.number as number,
    files,
    votes,
    matches,
    rated: votes.filter((vote) => vote.voto !== null).length,
  };
}
