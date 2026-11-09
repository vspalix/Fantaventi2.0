import { getFantasyTeam, getCurrentSeason, loadCatalog } from "@/lib/server/catalog";
import { getLeagueDetail } from "@/lib/server/leagues";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { filedPlayerScore, liveFormula, projectLiveScore } from "@/lib/engine/calculator";
import { overlayPublishedVotes } from "@/lib/server/live-projection";
import { formationIssue } from "@/lib/formations";
import { headToHeadPoints, weekScoreMode, type LeaguePhase, type LeagueRules } from "@/lib/league-rules";
import { fantasyPointsForLeague } from "@/lib/server/league-scores";
import { definitionForLeague, readLeagueSettings } from "@/lib/server/league-settings";
import { previewProvisional } from "@/lib/server/live-score";
import { loadWeekMatchState, type WeekMatchState } from "@/lib/server/roster";
import type {
  CatalogPlayer,
  HubFixture,
  LeagueHubData,
  LeagueSquad,
  LiveLineupSheet,
  LivePlayerRow,
  LineupPick,
  LineupOrigin,
  OpponentLineup,
  PartialStanding,
  PlayerRole,
  StandingRow,
} from "@/lib/types";

const ROLE_ORDER: Record<PlayerRole, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

const CLOSED = new Set(["locked", "scored", "final"]);

type GameweekRow = {
  id: string;
  number: number;
  deadline_at: string;
  status: string;
};

type SlotRow = {
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
  is_starter?: boolean;
  slot_order?: number;
};

type LineupRow = {
  fantasy_team_id: string;
  lineup_slots: SlotRow[] | null;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function isLocked(gameweek: GameweekRow, now: number, inPlay: Set<number>) {
  return CLOSED.has(gameweek.status)
    || inPlay.has(gameweek.number)
    || new Date(gameweek.deadline_at).getTime() <= now;
}

function weekUnderway(gameweek: GameweekRow, now: number, state: WeekMatchState) {
  if (gameweek.status === "scored" || gameweek.status === "final") return false;
  const started = state.inPlay.has(gameweek.number) || new Date(gameweek.deadline_at).getTime() <= now;
  if (!started || !state.withMatches.has(gameweek.number)) return false;
  return !state.finished.has(gameweek.number);
}

function slotsOf(row: LineupRow): SlotRow[] {
  const slots = row.lineup_slots as SlotRow[] | SlotRow | null;
  if (!slots) return [];
  return Array.isArray(slots) ? slots : [slots];
}

function emptyPick(): LineupPick {
  return { playerIds: [], benchIds: [], captainId: null, viceId: null };
}

function orderedSlots(slots: SlotRow[], starter: boolean) {
  return slots
    .filter((slot) => (slot.is_starter !== false) === starter)
    .sort((left, right) => (left.slot_order ?? 0) - (right.slot_order ?? 0));
}

function pickFromSlots(slots: SlotRow[]): LineupPick {
  const starters = orderedSlots(slots, true);
  const captain = starters.find((slot) => slot.is_captain);
  const vice = starters.find((slot) => slot.is_vice_captain);
  return {
    playerIds: starters.map((slot) => slot.player_id),
    benchIds: orderedSlots(slots, false).map((slot) => slot.player_id),
    captainId: captain?.player_id ?? null,
    viceId: vice?.player_id ?? null,
  };
}

function restrictPick(pick: LineupPick, rosterIds: Set<string>): LineupPick {
  const playerIds = pick.playerIds.filter((playerId) => rosterIds.has(playerId));
  const onPitch = new Set(playerIds);
  const benchIds = pick.benchIds.filter((playerId) => rosterIds.has(playerId) && !onPitch.has(playerId));
  return {
    playerIds,
    benchIds,
    captainId: pick.captainId && onPitch.has(pick.captainId) ? pick.captainId : null,
    viceId: pick.viceId && onPitch.has(pick.viceId) && pick.viceId !== pick.captainId ? pick.viceId : null,
  };
}

async function carriedLineup(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  seasonId: string,
  beforeNumber: number,
  rosterIds: Set<string>,
) {
  const { data: weeks, error: weekError } = await admin
    .from("gameweeks")
    .select("id, number")
    .eq("season_id", seasonId)
    .lt("number", beforeNumber)
    .order("number", { ascending: false });
  if (weekError) throw new Error(weekError.message);
  const weekRows = (weeks ?? []) as { id: string; number: number }[];
  if (weekRows.length === 0) return null;

  const { data: saved, error: savedError } = await admin
    .from("lineups")
    .select("gameweek_id")
    .eq("fantasy_team_id", teamId)
    .in("gameweek_id", weekRows.map((week) => week.id));
  if (savedError) throw new Error(savedError.message);
  const savedWeeks = new Set((saved ?? []).map((row) => row.gameweek_id as string));
  const source = weekRows.find((week) => savedWeeks.has(week.id));
  if (!source) return null;

  const rows = await lineupsFor(admin, source.id, [teamId]);
  const row = rows.find((item) => item.fantasy_team_id === teamId);
  if (!row) return null;
  const pick = restrictPick(pickFromSlots(slotsOf(row)), rosterIds);
  if (pick.playerIds.length === 0 && pick.benchIds.length === 0) return null;
  return { pick, number: source.number };
}

export async function loadLeagueHub(
  userId: string,
  leagueId: string,
  requestedGameweekId?: string | null,
): Promise<LeagueHubData> {
  const league = await getLeagueDetail(userId, leagueId);
  const admin = createAdminSupabase();
  const catalog = await loadCatalog(league.seasonId);
  const now = Date.now();
  const byId = new Map(catalog.players.map((player) => [player.id, player]));

  const { data: gameweekRows, error: gameweekError } = await admin
    .from("gameweeks")
    .select("id, number, deadline_at, status")
    .eq("season_id", league.seasonId)
    .gte("number", league.startMatchday)
    .lte("number", league.endMatchday)
    .order("number", { ascending: true });
  if (gameweekError) throw new Error(gameweekError.message);

  const rows = (gameweekRows ?? []) as GameweekRow[];
  const matchState = await loadWeekMatchState(admin, league.seasonId, now);
  const inPlay = matchState.inPlay;
  const liveWeek = rows.find((gameweek) => weekUnderway(gameweek, now, matchState)) ?? null;
  const next = liveWeek ? null : rows.find((gameweek) => !isLocked(gameweek, now, inPlay)) ?? null;
  const focus = liveWeek ?? next;
  const selected = rows.find((gameweek) => gameweek.id === requestedGameweekId)
    ?? focus
    ?? rows[rows.length - 1]
    ?? null;
  const locked = selected ? isLocked(selected, now, inPlay) : false;
  const editable = Boolean(selected && next && selected.id === next.id && !locked);

  const team = await getFantasyTeam(admin, userId, league.seasonId);
  const roster = team && selected
    ? await rosterForGameweek(admin, team.id, selected.number, byId)
    : [];

  const teamIds = league.participants.map((participant) => participant.fantasyTeamId);
  const lineupRows = selected && teamIds.length
    ? await lineupsFor(admin, selected.id, teamIds)
    : [];
  const mine = team ? lineupRows.find((row) => row.fantasy_team_id === team.id) : undefined;
  const rosterIds = new Set(roster.map((player) => player.id));
  let lineup = mine ? restrictPick(pickFromSlots(slotsOf(mine)), rosterIds) : emptyPick();
  let lineupOrigin: LineupOrigin = mine ? "saved" : "empty";
  let carriedFromMatchday: number | null = null;
  if (!mine && team && selected && editable) {
    const carried = await carriedLineup(admin, team.id, league.seasonId, selected.number, rosterIds);
    if (carried) {
      lineup = carried.pick;
      lineupOrigin = "previous";
      carriedFromMatchday = carried.number;
    }
  }

  const opponents: OpponentLineup[] = league.participants.map((participant) => {
    const row = lineupRows.find((item) => item.fantasy_team_id === participant.fantasyTeamId);
    const isMine = participant.fantasyTeamId === team?.id;
    const revealed = isMine || locked;
    const named = (slot: SlotRow) => {
      const player = byId.get(slot.player_id);
      return {
        playerId: slot.player_id,
        fullName: player?.fullName ?? "Calciatore",
        role: player?.role ?? "MID" as const,
        clubShort: player?.clubShort ?? "",
        isCaptain: slot.is_captain,
        isVice: slot.is_vice_captain,
      };
    };
    const source = revealed && row ? slotsOf(row) : [];
    const slots = source
      .filter((slot) => slot.is_starter !== false)
      .map(named)
      .sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || left.fullName.localeCompare(right.fullName, "it"));
    const bench = source
      .filter((slot) => slot.is_starter === false)
      .sort((left, right) => (left.slot_order ?? 0) - (right.slot_order ?? 0))
      .map(named);
    return {
      fantasyTeamId: participant.fantasyTeamId,
      teamName: participant.teamName,
      displayName: participant.displayName,
      isMine,
      filed: Boolean(row),
      revealed,
      slots,
      bench,
    };
  });
  const squads = await squadsFor(
    admin,
    league.participants,
    team?.id ?? null,
    selected?.number ?? league.startMatchday,
    byId,
  );
  const selectedUnderway = selected ? weekUnderway(selected, now, matchState) : false;
  const roles = new Map([...byId].map(([id, player]) => [id, player.role]));
  const selectedPreview = selectedUnderway && selected
    ? await loadPreview(selected.id, league.id, catalog.seasonCode, selected.number, roles)
    : null;
  const livePreview = liveWeek
    ? (liveWeek.id === selected?.id ? selectedPreview : await loadPreview(liveWeek.id, league.id, catalog.seasonCode, liveWeek.number, roles))
    : null;
  const partial = selectedPreview
    ? partialFromPreview(league.participants, selectedPreview.scores, opponents)
    : await partialStandings(admin, league.participants, selected?.id ?? null, opponents);
  const liveSheet = selectedPreview && team
    ? lineupSheet(lineup, roster, selectedPreview, team.id)
    : null;

  const standings = await standingsFor(admin, league, league.participants, rows, now, inPlay);
  const live = await liveStandingsFor(league.id, standings, livePreview);
  const season = await getCurrentSeason(admin, league.seasonId);
  const lastClosed = [...rows].reverse().find((gameweek) => isLocked(gameweek, now, inPlay)) ?? null;
  const liveRound = [...rows].reverse().find((gameweek) =>
    isLocked(gameweek, now, inPlay) && gameweek.status !== "scored" && gameweek.status !== "final"
  ) ?? null;
  const fixtureWeek = liveRound ?? next ?? lastClosed;
  let lineupSaved = false;
  let lineupSavedAt: string | null = null;
  if (team && focus) {
    const stamp = await admin
      .from("lineups")
      .select("saved_at")
      .eq("fantasy_team_id", team.id)
      .eq("gameweek_id", focus.id)
      .maybeSingle();
    if (stamp.error && /saved_at|schema cache/i.test(stamp.error.message)) {
      const saved = await admin
        .from("lineups")
        .select("id")
        .eq("fantasy_team_id", team.id)
        .eq("gameweek_id", focus.id)
        .maybeSingle();
      if (saved.error) throw new Error(saved.error.message);
      lineupSaved = Boolean(saved.data);
    } else if (stamp.error) {
      throw new Error(stamp.error.message);
    } else {
      lineupSaved = Boolean(stamp.data);
      lineupSavedAt = (stamp.data?.saved_at as string | null) ?? null;
    }
  }
  const lastRound = !lastClosed
    ? []
    : livePreview && lastClosed.id === liveWeek?.id
      ? partialFromPreview(league.participants, livePreview.scores, [])
      : await partialStandings(admin, league.participants, lastClosed.id, []);
  const fixtures = fixtureWeek ? await fixturesFor(admin, fixtureWeek.id, catalog.clubs) : [];

  return {
    league,
    gameweeks: rows.map((gameweek) => ({
      id: gameweek.id,
      number: gameweek.number,
      deadlineAt: gameweek.deadline_at,
      status: gameweek.status,
      locked: isLocked(gameweek, now, inPlay),
      isNext: next?.id === gameweek.id,
    })),
    selectedGameweekId: selected?.id ?? null,
    editable,
    revealOpponents: locked,
    roster,
    lineup,
    lineupOrigin,
    carriedFromMatchday,
    opponents,
    squads,
    partial,
    liveSheet,
    standings,
    liveStandings: live.rows,
    liveReady: live.ready,
    home: {
      competitionName: season.competitionName,
      phase: liveWeek ? "live" : next ? "countdown" : "none",
      deadlineAt: next?.deadline_at ?? null,
      gameweekNumber: focus?.number ?? null,
      focusGameweekId: focus?.id ?? null,
      lineupSaved,
      lineupSavedAt,
      lastRoundNumber: lastClosed?.number ?? null,
      lastRound,
      fixtureGameweekNumber: fixtureWeek?.number ?? null,
      fixtures,
    },
  };
}

async function fixturesFor(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  clubs: { id: string; shortName: string; name: string }[],
): Promise<HubFixture[]> {
  const extended = await admin
    .from("real_matches")
    .select("id, kickoff_at, status, home_club_id, away_club_id, home_goals, away_goals")
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });
  const plain = extended.error && /home_goals|away_goals/i.test(extended.error.message)
    ? await admin
      .from("real_matches")
      .select("id, kickoff_at, status, home_club_id, away_club_id")
      .eq("gameweek_id", gameweekId)
      .order("kickoff_at", { ascending: true })
    : extended;
  if (plain.error) throw new Error(plain.error.message);
  const names = new Map(clubs.map((club) => [club.id, club.shortName || club.name]));
  return (plain.data ?? []).map((row) => {
    const record = row as {
      id: string;
      kickoff_at: string;
      status: string;
      home_club_id: string;
      away_club_id: string;
      home_goals?: number | null;
      away_goals?: number | null;
    };
    return {
      id: record.id,
      home: names.get(record.home_club_id) ?? "Casa",
      away: names.get(record.away_club_id) ?? "Trasferta",
      kickoffAt: record.kickoff_at,
      status: record.status,
      homeGoals: record.home_goals == null ? null : Number(record.home_goals),
      awayGoals: record.away_goals == null ? null : Number(record.away_goals),
    };
  });
}

async function squadsFor(
  admin: ReturnType<typeof createAdminSupabase>,
  participants: LeagueHubData["league"]["participants"],
  myTeamId: string | null,
  gameweekNumber: number,
  byId: Map<string, CatalogPlayer>,
): Promise<LeagueSquad[]> {
  const teamIds = participants.map((participant) => participant.fantasyTeamId);
  if (teamIds.length === 0) return [];
  const { data, error } = await admin
    .from("roster_stints")
    .select("fantasy_team_id, player_id, active_from_gameweek, active_until_gameweek")
    .in("fantasy_team_id", teamIds);
  if (error) throw new Error(error.message);

  return participants.map((participant) => {
    const players = (data ?? [])
      .filter((stint) => {
        if (stint.fantasy_team_id !== participant.fantasyTeamId) return false;
        const from = stint.active_from_gameweek as number;
        const until = stint.active_until_gameweek as number | null;
        return from <= gameweekNumber && (until === null || until >= gameweekNumber);
      })
      .map((stint) => byId.get(stint.player_id as string))
      .filter((player): player is CatalogPlayer => Boolean(player))
      .sort((left, right) =>
        ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
        || left.fullName.localeCompare(right.fullName, "it"),
      )
      .map((player) => ({
        id: player.id,
        fullName: player.fullName,
        role: player.role,
        clubShort: player.clubShort,
      }));
    return {
      fantasyTeamId: participant.fantasyTeamId,
      teamName: participant.teamName,
      displayName: participant.displayName,
      isMine: participant.fantasyTeamId === myTeamId,
      players,
    };
  });
}

async function loadPreview(
  gameweekId: string,
  leagueId: string,
  seasonCode: string,
  gameweekNumber: number,
  roles: ReadonlyMap<string, PlayerRole>,
) {
  try {
    const preview = await previewProvisional(gameweekId);
    const { definition } = await definitionForLeague(createAdminSupabase(), leagueId, preview.definition);
    const stats = await overlayPublishedVotes(preview.stats, seasonCode, gameweekNumber, roles);
    return {
      definition,
      stats,
      scores: preview.lineups.map((lineup) => projectLiveScore(
        lineup.fantasyTeamId,
        gameweekId,
        lineup.slots,
        stats,
        definition,
      )),
    };
  } catch {
    return null;
  }
}

function partialFromPreview(
  participants: LeagueHubData["league"]["participants"],
  scores: Awaited<ReturnType<typeof previewProvisional>>["scores"],
  lineups: OpponentLineup[],
): PartialStanding[] {
  const filed = new Set(lineups.filter((lineup) => lineup.filed).map((lineup) => lineup.fantasyTeamId));
  const byTeam = new Map(scores.map((score) => [score.fantasyTeamId, score.provisionalTotal]));
  const ranked = participants.map((participant) => ({
    rank: 0,
    fantasyTeamId: participant.fantasyTeamId,
    teamName: participant.teamName,
    displayName: participant.displayName,
    points: round2(byTeam.get(participant.fantasyTeamId) ?? 0),
    filed: filed.has(participant.fantasyTeamId) || byTeam.has(participant.fantasyTeamId),
    live: true,
  })).sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points;
    return left.teamName.localeCompare(right.teamName, "it");
  });
  let lastPoints: number | null = null;
  ranked.forEach((row, index) => {
    if (row.points !== lastPoints) {
      row.rank = index + 1;
      lastPoints = row.points;
    } else {
      row.rank = ranked[index - 1]?.rank ?? index + 1;
    }
  });
  return ranked;
}

function lineupSheet(
  lineup: LineupPick,
  roster: CatalogPlayer[],
  preview: NonNullable<Awaited<ReturnType<typeof loadPreview>>>,
  fantasyTeamId: string,
): LiveLineupSheet {
  const byId = new Map(roster.map((player) => [player.id, player]));
  const score = preview.scores.find((item) => item.fantasyTeamId === fantasyTeamId);
  const played = new Map((score?.players ?? []).map((player) => [player.playerId, player]));
  const rowFor = (playerId: string, isCaptain: boolean, isVice: boolean): LivePlayerRow | null => {
    const player = byId.get(playerId);
    const rated = played.get(playerId);
    if (!player || !rated) return null;
    return {
      playerId,
      fullName: player.fullName,
      role: player.role,
      clubShort: player.clubShort,
      isCaptain,
      isVice,
      voto: rated.voto,
      bonus: rated.voto === null ? null : rated.bonusPoints,
      malus: rated.voto === null ? null : rated.malusPoints,
      fantavoto: rated.fantavoto,
      formula: liveFormula(rated.voto, rated.bonusPoints, rated.malusPoints),
    };
  };
  const onField = score?.players ?? [];
  const onFieldIds = new Set(onField.map((player) => player.playerId));
  return {
    starters: onField.flatMap((player) => {
      const row = rowFor(player.playerId, player.playerId === lineup.captainId, player.playerId === lineup.viceId);
      return row ? [row] : [];
    }),
    bench: lineup.benchIds.flatMap((playerId) => {
      if (onFieldIds.has(playerId)) return [];
      const player = byId.get(playerId);
      if (!player) return [];
      const stat = preview.stats.get(playerId);
      const rated = filedPlayerScore(stat ? { ...stat, postponed: false } : undefined, player.role, preview.definition, 1);
      return [{
        playerId,
        fullName: player.fullName,
        role: player.role,
        clubShort: player.clubShort,
        isCaptain: false,
        isVice: false,
        voto: rated.voto,
        bonus: rated.bonus,
        malus: rated.malus,
        fantavoto: rated.fantavoto,
        formula: liveFormula(rated.voto, rated.bonus ?? 0, rated.malus ?? 0),
      }];
    }),
    partialTotal: score ? round2(score.provisionalTotal) : null,
  };
}

async function partialStandings(
  admin: ReturnType<typeof createAdminSupabase>,
  participants: LeagueHubData["league"]["participants"],
  gameweekId: string | null,
  lineups: OpponentLineup[],
): Promise<PartialStanding[]> {
  const filed = new Set(lineups.filter((lineup) => lineup.filed).map((lineup) => lineup.fantasyTeamId));
  const scores = new Map<string, { points: number; live: boolean }>();
  const teamIds = participants.map((participant) => participant.fantasyTeamId);
  if (gameweekId && teamIds.length > 0) {
    const extended = await admin
      .from("team_gameweek_scores")
      .select("fantasy_team_id, total, provisional_total, is_live")
      .eq("gameweek_id", gameweekId)
      .in("fantasy_team_id", teamIds);
    const rows = extended.error && /provisional_total|is_live/i.test(extended.error.message)
      ? await admin
        .from("team_gameweek_scores")
        .select("fantasy_team_id, total")
        .eq("gameweek_id", gameweekId)
        .in("fantasy_team_id", teamIds)
      : extended;
    if (rows.error) throw new Error(rows.error.message);
    for (const row of rows.data ?? []) {
      const record = row as unknown as {
        fantasy_team_id: string;
        total: number | string | null;
        provisional_total?: number | string | null;
        is_live?: boolean;
      };
      const live = Boolean(record.is_live);
      scores.set(record.fantasy_team_id, {
        points: live ? Number(record.provisional_total ?? 0) : Number(record.total ?? 0),
        live,
      });
    }
  }

  const ranked = participants.map((participant) => {
    const cell = scores.get(participant.fantasyTeamId);
    return {
      rank: 0,
      fantasyTeamId: participant.fantasyTeamId,
      teamName: participant.teamName,
      displayName: participant.displayName,
      points: cell ? round2(cell.points) : null,
      filed: filed.has(participant.fantasyTeamId),
      live: cell?.live ?? false,
    };
  }).sort((left, right) => {
    if (left.points === null && right.points === null) return left.teamName.localeCompare(right.teamName, "it");
    if (left.points === null) return 1;
    if (right.points === null) return -1;
    if (right.points !== left.points) return right.points - left.points;
    return left.teamName.localeCompare(right.teamName, "it");
  });
  let lastPoints: number | null = null;
  ranked.forEach((row, index) => {
    if (row.points === null) {
      row.rank = 0;
      return;
    }
    if (row.points !== lastPoints) {
      row.rank = index + 1;
      lastPoints = row.points;
    } else {
      row.rank = ranked[index - 1]?.rank ?? index + 1;
    }
  });
  return ranked;
}

async function rosterForGameweek(
  admin: ReturnType<typeof createAdminSupabase>,
  teamId: string,
  gameweekNumber: number,
  byId: Map<string, CatalogPlayer>,
) {
  const { data, error } = await admin
    .from("roster_stints")
    .select("player_id, active_from_gameweek, active_until_gameweek")
    .eq("fantasy_team_id", teamId);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((stint) => {
      const from = stint.active_from_gameweek as number;
      const until = stint.active_until_gameweek as number | null;
      return from <= gameweekNumber && (until === null || until >= gameweekNumber);
    })
    .map((stint) => byId.get(stint.player_id as string))
    .filter((player): player is CatalogPlayer => Boolean(player))
    .sort((a, b) => a.role.localeCompare(b.role) || a.fullName.localeCompare(b.fullName, "it"));
}

async function lineupsFor(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekId: string,
  teamIds: string[],
) {
  const { data, error } = await admin
    .from("lineups")
    .select("id, fantasy_team_id")
    .eq("gameweek_id", gameweekId)
    .in("fantasy_team_id", teamIds);
  if (error) throw new Error(error.message);

  const lineupIds = (data ?? []).map((row) => row.id as string);
  const extended = lineupIds.length
    ? await admin
      .from("lineup_slots")
      .select("lineup_id, player_id, is_captain, is_vice_captain, is_starter, slot_order")
      .in("lineup_id", lineupIds)
    : { data: [], error: null };
  const plain = extended.error && /is_starter|slot_order/i.test(extended.error.message)
    ? await admin
      .from("lineup_slots")
      .select("lineup_id, player_id, is_captain, is_vice_captain")
      .in("lineup_id", lineupIds)
    : extended;
  if (plain.error) throw new Error(plain.error.message);

  return (data ?? []).map((row) => ({
    fantasy_team_id: row.fantasy_team_id as string,
    lineup_slots: (plain.data ?? [])
      .filter((slot) => slot.lineup_id === row.id)
      .map((slot) => {
        const record = slot as unknown as {
          player_id: string;
          is_captain: boolean;
          is_vice_captain: boolean;
          is_starter?: boolean;
          slot_order?: number;
        };
        return {
          player_id: record.player_id,
          is_captain: Boolean(record.is_captain),
          is_vice_captain: Boolean(record.is_vice_captain),
          is_starter: record.is_starter !== false,
          slot_order: Number(record.slot_order ?? 0),
        };
      }),
  }));
}

type StandingOptions = {
  allowLateEntry: boolean;
  phases: LeaguePhase[];
  goalBands: LeagueRules["goalBands"] | null;
  weekPoints: Map<string, number> | null;
  heldGameweekIds: Set<string>;
};

async function standingsFor(
  admin: ReturnType<typeof createAdminSupabase>,
  league: { id: string; seasonId: string; startMatchday: number },
  participants: LeagueHubData["league"]["participants"],
  gameweeks: GameweekRow[],
  now: number,
  inPlay: Set<number>,
): Promise<StandingRow[]> {
  const settings = await readLeagueSettings(admin, league.id);
  if (!settings.ready) {
    const fromDatabase = await standingsFromDatabase(admin, league.id, participants);
    if (fromDatabase) return fromDatabase;
  }
  let weekPoints: Map<string, number> | null = null;
  if (settings.ready) {
    try {
      const closed = gameweeks.filter((gameweek) => isLocked(gameweek, now, inPlay) && (gameweek.status === "scored" || gameweek.status === "final"));
      weekPoints = await fantasyPointsForLeague(
        league.id,
        league.seasonId,
        participants.map((participant) => participant.fantasyTeamId),
        closed.map((gameweek) => ({ id: gameweek.id, number: gameweek.number })),
      );
    } catch {
      weekPoints = null;
    }
  }
  return standingsInApp(admin, league.startMatchday, participants, gameweeks, now, inPlay, {
    allowLateEntry: settings.rules.enrollment !== "closed",
    phases: settings.rules.phases,
    goalBands: settings.rules.goalBands,
    weekPoints,
    heldGameweekIds: settings.rules.postponement === "wait_recovery"
      ? await postponedWeekIds(admin, gameweeks.map((gameweek) => gameweek.id))
      : new Set(),
  });
}

async function postponedWeekIds(
  admin: ReturnType<typeof createAdminSupabase>,
  gameweekIds: string[],
) {
  if (gameweekIds.length === 0) return new Set<string>();
  const flagged = await admin
    .from("real_matches")
    .select("gameweek_id")
    .in("gameweek_id", gameweekIds)
    .eq("postponed", true);
  if (flagged.error) return new Set<string>();
  return new Set((flagged.data ?? []).map((row) => row.gameweek_id as string));
}

async function standingsFromDatabase(
  admin: ReturnType<typeof createAdminSupabase>,
  leagueId: string,
  participants: LeagueHubData["league"]["participants"],
) {
  const { data, error } = await admin.rpc("league_standings", { p_league_id: leagueId });
  if (error) {
    if (/league_standings|could not find|schema cache|42883|PGRST202/i.test(error.message)) return null;
    throw new Error(error.message);
  }

  const names = new Map(participants.map((participant) => [participant.fantasyTeamId, participant]));
  const rows = ((data ?? []) as {
    fantasy_team_id: string;
    skipped_count: number;
    played_count: number;
    real_points: number | string;
    average_points: number | string | null;
    entry_points: number | string;
    total_points: number | string;
  }[]).flatMap((row) => {
    const participant = names.get(row.fantasy_team_id);
    if (!participant) return [];
    return [{
      rank: 0,
      fantasyTeamId: participant.fantasyTeamId,
      teamName: participant.teamName,
      displayName: participant.displayName,
      points: Number(row.total_points ?? 0),
      realPoints: Number(row.real_points ?? 0),
      entryPoints: Number(row.entry_points ?? 0),
      played: Number(row.played_count ?? 0),
      skipped: Number(row.skipped_count ?? 0),
      average: row.average_points === null ? null : Number(row.average_points),
      ratedPlayers: null,
      onPitch: null,
    }];
  });
  return rankStandings(rows);
}

class MissingLiveColumns extends Error {}

async function liveStandingsFor(
  leagueId: string,
  official: StandingRow[],
  preview: Awaited<ReturnType<typeof loadPreview>>,
) {
  const settings = await readLeagueSettings(createAdminSupabase(), leagueId);
  if (!preview || settings.rules.ranking === "head_to_head") {
    return { rows: official.map((row) => ({ ...row })), ready: true };
  }
  const extra = new Map(preview.scores.map((score) => [score.fantasyTeamId, score]));
  return {
    rows: rankStandings(official.map((row) => {
      const score = extra.get(row.fantasyTeamId);
      if (!score) return { ...row, ratedPlayers: null, onPitch: null };
      return {
        ...row,
        points: round2(row.points + score.provisionalTotal),
        ratedPlayers: score.ratedPlayersCount,
        onPitch: score.onPitchCount,
      };
    })),
    ready: true,
  };
}

async function standingsInApp(
  admin: ReturnType<typeof createAdminSupabase>,
  startMatchday: number,
  participants: LeagueHubData["league"]["participants"],
  gameweeks: GameweekRow[],
  now: number,
  inPlay: Set<number>,
  options: StandingOptions,
  live = false,
): Promise<StandingRow[]> {
  const teamIds = participants.map((participant) => participant.fantasyTeamId);
  if (teamIds.length === 0 || gameweeks.length === 0) {
    return rankStandings(participants.map((participant) => emptyStanding(participant)));
  }

  const closed = gameweeks.filter((gameweek) => isLocked(gameweek, now, inPlay));
  const allIds = gameweeks.map((gameweek) => gameweek.id);
  const scoreIds = (live ? gameweeks.filter((gameweek) => gameweek.status !== "final") : closed).map((gameweek) => gameweek.id);
  const numberById = new Map(gameweeks.map((gameweek) => [gameweek.id, gameweek.number]));

  const { data: lineupRows, error: lineupError } = await admin
    .from("lineups")
    .select("fantasy_team_id, gameweek_id")
    .in("fantasy_team_id", teamIds)
    .in("gameweek_id", allIds);
  if (lineupError) throw new Error(lineupError.message);

  const fielded = new Set<string>();
  const entryByTeam = new Map<string, number>();
  for (const row of lineupRows ?? []) {
    const teamId = row.fantasy_team_id as string;
    const number = numberById.get(row.gameweek_id as string);
    if (number === undefined) continue;
    fielded.add(`${teamId}:${row.gameweek_id as string}`);
    const current = entryByTeam.get(teamId);
    if (current === undefined || number < current) entryByTeam.set(teamId, number);
  }

  type ScoreCell = { points: number; rated: number | null; onPitch: number | null; live: boolean };
  const scores = new Map<string, ScoreCell>();
  if (scoreIds.length > 0) {
    const columns = live
      ? "fantasy_team_id, gameweek_id, total, provisional_total, is_live, rated_players_count, on_pitch_count"
      : "fantasy_team_id, gameweek_id, total";
    const { data, error } = await admin
      .from("team_gameweek_scores")
      .select(columns)
      .in("fantasy_team_id", teamIds)
      .in("gameweek_id", scoreIds);
    if (error) {
      if (live && /provisional_total|is_live|on_pitch_count|rated_players_count/i.test(error.message)) {
        throw new MissingLiveColumns(error.message);
      }
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      const record = row as unknown as {
        fantasy_team_id: string;
        gameweek_id: string;
        total: number | string | null;
        provisional_total?: number | string | null;
        is_live?: boolean;
        rated_players_count?: number | null;
        on_pitch_count?: number | null;
      };
      const isLive = Boolean(record.is_live);
      scores.set(`${record.fantasy_team_id}:${record.gameweek_id}`, {
        points: live && isLive ? Number(record.provisional_total ?? 0) : Number(record.total ?? 0),
        rated: record.rated_players_count ?? null,
        onPitch: record.on_pitch_count ?? null,
        live: isLive,
      });
    }
  }

  const liveWeekIds = new Set(
    [...scores.entries()].filter(([, cell]) => cell.live).map(([key]) => key.split(":")[1]),
  );
  const countedBase = live
    ? gameweeks.filter((gameweek) => gameweek.status !== "final" && (isLocked(gameweek, now, inPlay) || liveWeekIds.has(gameweek.id)))
    : closed;

  const badgeWeek = [...countedBase].reverse().find((gameweek) => gameweek.status !== "final") ?? null;

  const fantasyOf = (teamId: string, gameweekId: string) => {
    const key = `${teamId}:${gameweekId}`;
    if (options.weekPoints?.has(key)) return options.weekPoints.get(key) ?? 0;
    return scores.get(key)?.points ?? 0;
  };
  const modeOf = (gameweekNumber: number) => weekScoreMode({ phases: options.phases }, gameweekNumber);
  const seasonBase = countedBase.filter((gameweek) => {
    const mode = modeOf(gameweek.number);
    if (mode === "knockout") return false;
    if (mode === "head_to_head" && options.heldGameweekIds.has(gameweek.id)) return false;
    return true;
  });
  const matchPoints = new Map<string, number>();
  if (!live) {
    for (const gameweek of seasonBase) {
      if (modeOf(gameweek.number) !== "head_to_head") continue;
      const fantasy = new Map(participants.map((participant) => [
        participant.fantasyTeamId,
        fantasyOf(participant.fantasyTeamId, gameweek.id),
      ]));
      const awarded = headToHeadPoints(
        participants.map((participant) => participant.fantasyTeamId),
        gameweek.number,
        fantasy,
        options.goalBands ?? undefined,
      );
      for (const [teamId, points] of awarded) matchPoints.set(`${teamId}:${gameweek.id}`, points);
    }
  }

  const pointsOf = (teamId: string, gameweekId: string) => {
    const key = `${teamId}:${gameweekId}`;
    const number = numberById.get(gameweekId) ?? 0;
    if (!live && modeOf(number) === "head_to_head") return matchPoints.get(key) ?? 0;
    if (!live && modeOf(number) === "knockout") return 0;
    return fantasyOf(teamId, gameweekId);
  };
  const priorAverage = (beforeNumber: number) => {
    const weeks = seasonBase.filter((gameweek) => gameweek.number < beforeNumber);
    const cells = weeks.length * participants.length;
    if (cells === 0) return null;
    const sum = weeks.reduce((weekSum, gameweek) => (
      weekSum + participants.reduce((teamSum, team) => teamSum + pointsOf(team.fantasyTeamId, gameweek.id), 0)
    ), 0);
    return sum / cells;
  };

  return rankStandings(participants.map((participant) => {
    const entry = entryByTeam.get(participant.fantasyTeamId) ?? null;
    const late = options.allowLateEntry && entry !== null && entry > startMatchday;
    const skipped = late ? seasonBase.filter((gameweek) => gameweek.number < entry).length : 0;
    const counted = late
      ? seasonBase.filter((gameweek) => gameweek.number >= entry && fielded.has(`${participant.fantasyTeamId}:${gameweek.id}`))
      : seasonBase;
    const realPoints = counted.reduce((sum, gameweek) => sum + pointsOf(participant.fantasyTeamId, gameweek.id), 0);
    const badge = badgeWeek ? scores.get(`${participant.fantasyTeamId}:${badgeWeek.id}`) : undefined;
    const played = counted.length;
    const average = late ? priorAverage(entry) : (played === 0 ? null : realPoints / played);
    const entryPoints = !late || average === null || skipped === 0 ? 0 : average * skipped;
    const points = realPoints + entryPoints;
    return {
      ...emptyStanding(participant),
      points: round2(points),
      realPoints: round2(realPoints),
      entryPoints: round2(entryPoints),
      played,
      skipped,
      average: average === null ? null : round2(average),
      ratedPlayers: live ? badge?.rated ?? null : null,
      onPitch: live ? badge?.onPitch ?? null : null,
    };
  }));
}

function emptyStanding(participant: LeagueHubData["league"]["participants"][number]): StandingRow {
  return {
    rank: 0,
    fantasyTeamId: participant.fantasyTeamId,
    teamName: participant.teamName,
    displayName: participant.displayName,
    points: 0,
    realPoints: 0,
    entryPoints: 0,
    played: 0,
    skipped: 0,
    average: null,
    ratedPlayers: null,
    onPitch: null,
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function rankStandings(rows: StandingRow[]) {
  const ranked = [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.realPoints !== a.realPoints) return b.realPoints - a.realPoints;
    return a.teamName.localeCompare(b.teamName, "it");
  });
  let lastKey = "";
  ranked.forEach((row, index) => {
    const key = `${row.points}:${row.realPoints}`;
    if (key !== lastKey) {
      row.rank = index + 1;
      lastKey = key;
    } else {
      row.rank = ranked[index - 1]?.rank ?? index + 1;
    }
  });
  return ranked;
}

export async function saveLeagueLineup(
  userId: string,
  leagueId: string,
  input: { gameweekId: string; playerIds: string[]; benchIds: string[]; captainId: string | null; viceId: string | null },
) {
  const hub = await loadLeagueHub(userId, leagueId, input.gameweekId);
  if (!hub.selectedGameweekId || hub.selectedGameweekId !== input.gameweekId) {
    throw httpError("Questa giornata non è nel range della lega.", 400);
  }
  if (!hub.editable) {
    throw httpError("La formazione si modifica nel countdown, a giornata precedente finita e prima della deadline.", 409);
  }
  const { assertWritesOpen } = await import("@/lib/server/maintenance");
  await assertWritesOpen();

  const admin = createAdminSupabase();
  const team = await getFantasyTeam(admin, userId, hub.league.seasonId);
  if (!team) throw httpError("Prima salva la rosa: la formazione usa quei calciatori.", 400);

  const playerIds = [...new Set(input.playerIds)];
  const benchIds = [...new Set(input.benchIds)].filter((playerId) => !playerIds.includes(playerId));
  const shapeIssue = formationIssue(hub.roster, playerIds);
  if (shapeIssue) throw httpError(shapeIssue, 400);
  const known = new Set(hub.roster.map((player) => player.id));
  if (benchIds.some((playerId) => !known.has(playerId))) {
    throw httpError("Ogni panchinaro deve essere in rosa per questa giornata.", 400);
  }
  const unassigned = hub.roster.filter((player) => !playerIds.includes(player.id) && !benchIds.includes(player.id));
  if (unassigned.length > 0) {
    throw httpError("Metti in panchina i calciatori che non sono in campo.", 400);
  }
  if (!input.captainId || !playerIds.includes(input.captainId)) {
    throw httpError("Scegli un capitano tra i titolari.", 400);
  }
  if (playerIds.length > 1 && (!input.viceId || input.viceId === input.captainId || !playerIds.includes(input.viceId))) {
    throw httpError("Scegli un vice diverso dal capitano.", 400);
  }

  const { error } = await admin.rpc("submit_lineup", {
    p_fantasy_team_id: team.id,
    p_gameweek_id: input.gameweekId,
    p_player_ids: playerIds,
    p_captain_id: input.captainId,
    p_vice_captain_id: playerIds.length === 1 ? null : input.viceId,
    p_bench_ids: benchIds,
  });
  if (error) {
    if (/p_bench_ids|is_starter|schema cache/i.test(error.message)) {
      throw httpError("Per salvare la panchina riesegui submit_lineup in league_hub.sql.", 409);
    }
    throw new Error(error.message);
  }

  const stamped = await admin
    .from("lineups")
    .update({ saved_at: new Date().toISOString() })
    .eq("fantasy_team_id", team.id)
    .eq("gameweek_id", input.gameweekId);
  if (stamped.error && !/saved_at|schema cache/i.test(stamped.error.message)) throw new Error(stamped.error.message);

  return loadLeagueHub(userId, leagueId, input.gameweekId);
}
