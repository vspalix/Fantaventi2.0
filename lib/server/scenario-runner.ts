import { randomUUID } from "node:crypto";
import { TEST_TEAM_PASSWORD } from "@/lib/admin-types";
import { totalsDelta } from "@/lib/chaos/delta";
import { evaluateRoster } from "@/lib/constraints";
import { autoLineup } from "@/lib/formations";
import { headToHeadPoints, weekScoreMode, type GoalBand, type MarketCheckpoint } from "@/lib/league-rules";
import { SCENARIO_ACTIONS } from "@/lib/scenario/registry";
import { buildLegalRoster } from "@/lib/scenario/roster";
import {
  SANDBOX_WEEK_BASE,
  sandboxWeek,
  scenarioNarrative,
  type ScenarioReport,
  type ScenarioScript,
  type ScenarioStep,
  type ScenarioStepReport,
} from "@/lib/scenario/script";
import { parseEmergencyVotes } from "@/lib/adapters/emergency-votes";
import { ensureFantasyTeam, ensureProfile, getCurrentSeason, loadCatalog } from "@/lib/server/catalog";
import { fileForgottenLineups } from "@/lib/server/forgotten-lineup";
import { readLeagueSettings } from "@/lib/server/league-settings";
import { saveLeagueLineup } from "@/lib/server/league-hub";
import { createLeague, joinLeague, updateLeague } from "@/lib/server/leagues";
import { refreshProvisionalScores, scoreOfficialGameweek } from "@/lib/server/live-score";
import { recalculateExtraordinary, setMatchPostponed } from "@/lib/server/match-control";
import { loadRosterMarket, saveRoster } from "@/lib/server/roster";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { CatalogResponse } from "@/lib/types";
import type { LeagueRules } from "@/lib/league-rules";

type Admin = ReturnType<typeof createAdminSupabase>;

type ScenarioUser = {
  alias: string;
  id: string;
  email: string;
  teamName: string;
  teamId: string | null;
};

type ScenarioLeague = {
  alias: string;
  id: string;
  name: string;
  joinCode: string;
  ownerAlias: string;
};

type PendingTrade = {
  from: string;
  to: string;
  outId: string;
  inId: string;
};

type Handler = (step: ScenarioStep, ctx: RunContext) => Promise<string>;

type RunContext = {
  admin: Admin;
  seasonId: string;
  catalog: CatalogResponse;
  users: Map<string, ScenarioUser>;
  leagues: Map<string, ScenarioLeague>;
  weeks: Map<number, { id: string; sandbox: number }>;
  matches: Map<string, string>;
  trades: Map<string, PendingTrade>;
  actor: string | null;
  lastError: string | null;
  teamSerial: number;
};

function text(value: unknown, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim();
}

function integer(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isInteger(parsed) ? parsed : fallback;
}

function slug(value: string) {
  const clean = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return clean || "user";
}

function scenarioName(value: string) {
  const trimmed = value.trim();
  const prefixed = trimmed.toLowerCase().startsWith("scenario ") ? trimmed : `Scenario ${trimmed}`;
  return prefixed.slice(0, 40);
}

async function findOrCreateUser(admin: Admin, email: string) {
  const created = await admin.auth.admin.createUser({
    email,
    password: TEST_TEAM_PASSWORD,
    email_confirm: true,
  });
  if (!created.error && created.data.user) return created.data.user.id;
  const message = created.error?.message ?? "";
  if (!/already|registered|exists|già/i.test(message)) {
    throw new Error(message || `Impossibile creare ${email}.`);
  }
  for (let page = 1; page <= 10; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    const found = listed.data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found.id;
    if (listed.data.users.length < 200) break;
  }
  throw new Error(`L'utente ${email} esiste già e non è stato recuperato.`);
}

function userOf(ctx: RunContext, value: unknown) {
  const alias = text(value) || ctx.actor || "";
  const user = ctx.users.get(alias);
  if (!user) throw new Error(`Utente di scenario sconosciuto: ${alias || "nessun attore"}.`);
  return user;
}

function leagueOf(ctx: RunContext, value: unknown) {
  const alias = text(value);
  const league = ctx.leagues.get(alias);
  if (!league) throw new Error(`Lega di scenario sconosciuta: ${alias || "manca l'alias"}.`);
  return league;
}

async function ensureWeek(ctx: RunContext, value: unknown) {
  const scriptWeek = integer(value, 0);
  const sandbox = sandboxWeek(scriptWeek);
  const existing = ctx.weeks.get(scriptWeek);
  if (existing) return { scriptWeek, ...existing };
  const found = await ctx.admin
    .from("gameweeks")
    .select("id, number")
    .eq("season_id", ctx.seasonId)
    .eq("number", sandbox)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  const id = (found.data?.id as string | undefined) ?? randomUUID();
  if (!found.data) {
    const inserted = await ctx.admin.from("gameweeks").insert({
      id,
      season_id: ctx.seasonId,
      number: sandbox,
      deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: "open",
    });
    if (inserted.error) throw new Error(inserted.error.message);
  }
  ctx.weeks.set(scriptWeek, { id, sandbox });
  return { scriptWeek, id, sandbox };
}

function playerTokens(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return text(value).split(/[,|]/).map((item) => item.trim()).filter(Boolean);
}

function resolveRoster(ctx: RunContext, value: unknown, teamIndex: number) {
  const tokens = playerTokens(value);
  if (tokens.length === 0 || tokens[0] === "auto") {
    return buildLegalRoster(ctx.catalog.players, ctx.catalog.clubs, ctx.catalog.rules, teamIndex).map((player) => player.id);
  }
  const byId = new Map(ctx.catalog.players.map((player) => [player.id, player]));
  return tokens.map((token) => {
    if (byId.has(token)) return token;
    const club = ctx.catalog.players.filter((player) => player.clubCode.toLowerCase() === token.toLowerCase());
    const choice = club[teamIndex % Math.max(club.length, 1)];
    if (!choice) throw new Error(`Calciatore o club sconosciuto: ${token}.`);
    return choice.id;
  });
}

async function rememberTeam(ctx: RunContext, user: ScenarioUser) {
  const team = await ctx.admin
    .from("fantasy_teams")
    .select("id")
    .eq("user_id", user.id)
    .eq("season_id", ctx.seasonId)
    .maybeSingle();
  if (team.error) throw new Error(team.error.message);
  user.teamId = (team.data?.id as string | undefined) ?? null;
  return user.teamId;
}

async function applyRoster(ctx: RunContext, user: ScenarioUser, playerIds: string[]) {
  const market = await loadRosterMarket(ctx.admin, ctx.seasonId);
  const realLock = market.locked && (market.gameweekNumber ?? 0) < SANDBOX_WEEK_BASE;
  if (!realLock) {
    await saveRoster(user.id, user.email, user.teamName, playerIds);
    await rememberTeam(ctx, user);
    return "Rosa salvata dal percorso di gioco.";
  }
  const teamId = await ensureFantasyTeam(ctx.admin, user.id, ctx.seasonId, user.teamName);
  user.teamId = teamId;
  const removed = await ctx.admin.from("roster_stints").delete().eq("fantasy_team_id", teamId);
  if (removed.error) throw new Error(removed.error.message);
  const inserted = await ctx.admin.from("roster_stints").insert(playerIds.map((playerId) => ({
    id: randomUUID(),
    fantasy_team_id: teamId,
    player_id: playerId,
    active_from_gameweek: 1,
    active_until_gameweek: null,
  })));
  if (inserted.error) throw new Error(inserted.error.message);
  const validated = await ctx.admin.rpc("validate_fantasy_team_roster", {
    p_fantasy_team_id: teamId,
    p_gameweek: sandboxWeek(1),
  });
  if (validated.error) throw new Error(validated.error.message);
  return `Il mercato reale è chiuso alla giornata ${market.gameweekNumber}. La rosa di scenario è stata validata e scritta sulla sandbox.`;
}

async function currentRosterIds(ctx: RunContext, user: ScenarioUser) {
  const teamId = user.teamId ?? await rememberTeam(ctx, user);
  if (!teamId) return [];
  const stints = await ctx.admin
    .from("roster_stints")
    .select("player_id, active_from_gameweek, active_until_gameweek")
    .eq("fantasy_team_id", teamId);
  if (stints.error) throw new Error(stints.error.message);
  return (stints.data ?? [])
    .filter((stint) => {
      const until = stint.active_until_gameweek == null ? null : Number(stint.active_until_gameweek);
      return Number(stint.active_from_gameweek) <= sandboxWeek(1) && (until == null || until >= sandboxWeek(1));
    })
    .map((stint) => stint.player_id as string);
}

function catalogOf(ctx: RunContext, playerIds: string[]) {
  const byId = new Map(ctx.catalog.players.map((player) => [player.id, player]));
  return playerIds.flatMap((playerId) => {
    const player = byId.get(playerId);
    return player ? [player] : [];
  });
}

async function lineupFor(ctx: RunContext, user: ScenarioUser, step: ScenarioStep) {
  const rosterIds = await currentRosterIds(ctx, user);
  const roster = catalogOf(ctx, rosterIds);
  const explicit = playerTokens(step.params.players);
  if (explicit.length > 0 && explicit[0] !== "auto") {
    const starters = explicit.map((token) => resolveRoster(ctx, token, 0)[0]).filter((id): id is string => Boolean(id));
    const bench = playerTokens(step.params.bench);
    const captain = text(step.params.captain) || starters[0];
    const vice = text(step.params.vice) || starters[1];
    if (!captain || !vice) throw new Error("Servono capitano e vice tra i titolari.");
    return { starters, bench, captain, vice };
  }
  const picked = autoLineup(roster.map((player) => ({ ...player, name: player.fullName })));
  if (!picked?.captainId || !picked.viceId) throw new Error("La rosa non basta per un modulo.");
  return {
    starters: picked.playerIds,
    bench: picked.benchIds,
    captain: picked.captainId,
    vice: picked.viceId,
  };
}

function leagueFor(ctx: RunContext, step: ScenarioStep, user: ScenarioUser) {
  if (step.params.league) return leagueOf(ctx, step.params.league);
  return [...ctx.leagues.values()].find((league) => league.ownerAlias === user.alias)
    ?? [...ctx.leagues.values()][0]
    ?? null;
}

async function submitOnce(
  ctx: RunContext,
  user: ScenarioUser,
  weekId: string,
  pick: { starters: string[]; bench: string[]; captain: string; vice: string },
  leagueId: string | null,
) {
  if (leagueId) {
    try {
      await saveLeagueLineup(user.id, leagueId, {
        gameweekId: weekId,
        playerIds: pick.starters,
        benchIds: pick.bench,
        captainId: pick.captain,
        viceId: pick.vice,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/range|giornata non è nel range|non è nel range/i.test(message)) throw error;
    }
  }
  const saved = await ctx.admin.rpc("submit_lineup", {
    p_fantasy_team_id: user.teamId,
    p_gameweek_id: weekId,
    p_player_ids: pick.starters,
    p_captain_id: pick.captain,
    p_vice_captain_id: pick.vice,
    p_bench_ids: pick.bench,
  });
  if (saved.error) throw new Error(saved.error.message);
}

function bandsOf(value: unknown): GoalBand[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const band = item as { min?: unknown; goals?: unknown };
      return [{ min: Number(band.min), goals: Number(band.goals) }];
    }).filter((band) => Number.isFinite(band.min) && Number.isFinite(band.goals));
  }
  return text(value).split("|").flatMap((part) => {
    const [min, goals] = part.split(":");
    if (!min || !goals) return [];
    return [{ min: Number(min), goals: Number(goals) }];
  }).filter((band) => Number.isFinite(band.min) && Number.isFinite(band.goals));
}

function checkpointsOf(value: unknown): MarketCheckpoint[] {
  const source = Array.isArray(value) ? value : text(value).split("|").map((part) => {
    const [afterMatchday, changes] = part.split(":");
    return { afterMatchday, changes };
  });
  return source.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { afterMatchday?: unknown; changes?: unknown };
    const after = Number(row.afterMatchday);
    const changes = Number(row.changes);
    if (!Number.isInteger(after) || !Number.isInteger(changes)) return [];
    const mapped = after > SANDBOX_WEEK_BASE ? after : sandboxWeek(after);
    return [{ afterMatchday: mapped, changes }];
  });
}

async function fingerprint(ctx: RunContext, weekId: string, teamIds: string[]) {
  const scores = await ctx.admin
    .from("team_gameweek_scores")
    .select("fantasy_team_id, total")
    .eq("gameweek_id", weekId)
    .in("fantasy_team_id", teamIds);
  if (scores.error) throw new Error(scores.error.message);
  const players = await ctx.admin
    .from("lineup_player_scores")
    .select("fantasy_team_id, player_id, player_points")
    .eq("gameweek_id", weekId)
    .in("fantasy_team_id", teamIds);
  if (players.error) throw new Error(players.error.message);
  const totals = (scores.data ?? [])
    .map((row) => ({ id: row.fantasy_team_id as string, total: Number(row.total) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const rows = (players.data ?? []).map((row) => `${row.fantasy_team_id}:${row.player_id}:${Number(row.player_points)}`).sort();
  const unique = new Set((players.data ?? []).map((row) => `${row.fantasy_team_id}:${row.player_id}`));
  return { totals, rows, duplicates: rows.length - unique.size };
}

async function wipeScenario(admin: Admin, seasonId: string) {
  const weeks = await admin
    .from("gameweeks")
    .select("id")
    .eq("season_id", seasonId)
    .gte("number", SANDBOX_WEEK_BASE + 1)
    .lte("number", SANDBOX_WEEK_BASE + 20);
  const weekIds = (weeks.data ?? []).map((row) => row.id as string);
  const teams = await admin.from("fantasy_teams").select("id").eq("season_id", seasonId).ilike("name", "Scenario %");
  const teamIds = (teams.data ?? []).map((row) => row.id as string);
  const leagues = await admin.from("private_leagues").select("id").eq("season_id", seasonId).ilike("name", "Scenario %");
  const leagueIds = (leagues.data ?? []).map((row) => row.id as string);
  if (weekIds.length > 0) {
    await admin.from("lineup_player_scores").delete().in("gameweek_id", weekIds);
    await admin.from("team_gameweek_scores").delete().in("gameweek_id", weekIds);
    const lineups = await admin.from("lineups").select("id").in("gameweek_id", weekIds);
    const lineupIds = (lineups.data ?? []).map((row) => row.id as string);
    if (lineupIds.length > 0) await admin.from("lineup_slots").delete().in("lineup_id", lineupIds);
    await admin.from("lineups").delete().in("gameweek_id", weekIds);
    await admin.from("player_gameweek_stats").delete().in("gameweek_id", weekIds);
    await admin.from("vote_imports").delete().in("gameweek_id", weekIds);
    await admin.from("real_matches").delete().in("gameweek_id", weekIds);
  }
  if (teamIds.length > 0) {
    const uses = await admin.from("roster_checkpoint_uses").delete().in("fantasy_team_id", teamIds);
    if (uses.error && !/schema cache|could not find|does not exist/i.test(uses.error.message)) {
      throw new Error(uses.error.message);
    }
    await admin.from("roster_stints").delete().in("fantasy_team_id", teamIds);
  }
  if (leagueIds.length > 0) await admin.from("private_league_members").delete().in("private_league_id", leagueIds);
  if (leagueIds.length > 0) await admin.from("private_leagues").delete().in("id", leagueIds);
  if (teamIds.length > 0) await admin.from("fantasy_teams").delete().in("id", teamIds);
  if (weekIds.length > 0) await admin.from("gameweeks").delete().in("id", weekIds);
}

const handlers: Record<string, Handler> = {
  async CREATE_USER(step, ctx) {
    const alias = text(step.as) || text(step.params.alias);
    if (!alias) throw new Error("CREATE_USER vuole un alias nel campo as.");
    const email = `scenario-${slug(alias)}@fantaventi.test`;
    const id = await findOrCreateUser(ctx.admin, email);
    await ensureProfile(ctx.admin, id, email);
    const user: ScenarioUser = {
      alias,
      id,
      email,
      teamName: scenarioName(alias),
      teamId: null,
    };
    ctx.users.set(alias, user);
    ctx.actor = alias;
    return `Utente ${alias} pronto.`;
  },

  async LOGIN(step, ctx) {
    const user = userOf(ctx, step.params.user);
    const auth = await ctx.admin.auth.admin.getUserById(user.id);
    if (auth.error || !auth.data.user) throw new Error(auth.error?.message ?? "Login non riuscito.");
    ctx.actor = user.alias;
    return `Sessione di scenario su ${user.alias}.`;
  },

  async SET_ROLE(step, ctx) {
    const user = userOf(ctx, step.params.user);
    if (!user.email.startsWith("scenario-") || !user.email.endsWith("@fantaventi.test")) {
      throw new Error("Il ruolo si cambia solo sugli utenti creati dallo scenario.");
    }
    const role = text(step.params.role, "member");
    if (role !== "member" && role !== "super_admin") throw new Error("Ruolo ammesso: member o super_admin.");
    const updated = await ctx.admin.from("profiles").update({ platform_role: role }).eq("id", user.id);
    if (updated.error) throw new Error(updated.error.message);
    return `${user.alias} è ${role}.`;
  },

  async IMPERSONATE(step, ctx) {
    const user = userOf(ctx, step.params.user);
    ctx.actor = user.alias;
    return `Attore: ${user.alias}.`;
  },

  async REMOVE_MEMBER(step, ctx) {
    const league = leagueOf(ctx, step.params.league);
    const user = userOf(ctx, step.params.user);
    const teamId = user.teamId ?? await rememberTeam(ctx, user);
    if (!teamId) throw new Error(`${user.alias} non ha una squadra.`);
    const removed = await ctx.admin
      .from("private_league_members")
      .delete()
      .eq("private_league_id", league.id)
      .eq("fantasy_team_id", teamId);
    if (removed.error) throw new Error(removed.error.message);
    return `${user.alias} tolto da ${league.alias}.`;
  },

  async CREATE_LEAGUE(step, ctx) {
    const alias = text(step.as) || text(step.params.alias);
    if (!alias) throw new Error("CREATE_LEAGUE vuole un alias nel campo as.");
    const owner = userOf(ctx, step.params.owner);
    const name = scenarioName(text(step.params.name, alias));
    const created = await createLeague(owner.id, owner.email, name, step.params);
    const ranged = await ctx.admin.from("private_leagues").update({
      start_matchday: SANDBOX_WEEK_BASE + 1,
      end_matchday: SANDBOX_WEEK_BASE + 20,
    }).eq("id", created.id);
    const rangeNote = ranged.error
      ? " Il range resta quello della stagione perché il database non accetta le giornate di scenario."
      : " Il range della lega è sulle giornate di scenario.";
    ctx.leagues.set(alias, {
      alias,
      id: created.id,
      name,
      joinCode: created.joinCode,
      ownerAlias: owner.alias,
    });
    return `Lega ${alias} (${text(step.params.format, "classic")}), codice ${created.joinCode}.${rangeNote}`;
  },

  async JOIN_LEAGUE(step, ctx) {
    const user = userOf(ctx, step.params.user);
    const league = leagueOf(ctx, step.params.league);
    await joinLeague(user.id, user.email, league.joinCode);
    return `${user.alias} è dentro ${league.alias}.`;
  },

  async SET_RULES(step, ctx) {
    const league = leagueOf(ctx, step.params.league);
    const owner = userOf(ctx, league.ownerAlias);
    const rules: Partial<LeagueRules> = {};
    if (step.params.format != null) rules.format = text(step.params.format) as LeagueRules["format"];
    if (step.params.defenseEnabled != null) rules.defenseEnabled = step.params.defenseEnabled === true;
    if (step.params.captainEnabled != null) rules.captainEnabled = step.params.captainEnabled === true;
    if (step.params.captainMultiplier != null) rules.captainMultiplier = Number(step.params.captainMultiplier) as LeagueRules["captainMultiplier"];
    if (step.params.cleanSheetEnabled != null) rules.cleanSheetEnabled = step.params.cleanSheetEnabled === true;
    if (step.params.cleanSheetPoints != null) rules.cleanSheetPoints = Number(step.params.cleanSheetPoints);
    if (step.params.missedLineup != null) rules.missedLineup = text(step.params.missedLineup) as LeagueRules["missedLineup"];
    if (step.params.missedLineupPenalty != null) rules.missedLineupPenalty = Number(step.params.missedLineupPenalty);
    if (step.params.postponement != null) rules.postponement = text(step.params.postponement) as LeagueRules["postponement"];
    if (step.params.exclusiveRosters != null) rules.exclusiveRosters = step.params.exclusiveRosters === true;
    if (step.params.goalBands != null) rules.goalBands = bandsOf(step.params.goalBands);
    await updateLeague(owner.id, league.id, { rules });
    return `Regole di ${league.alias} aggiornate.`;
  },

  async SET_CHECKPOINTS(step, ctx) {
    const league = leagueOf(ctx, step.params.league);
    const owner = userOf(ctx, league.ownerAlias);
    const checkpoints = checkpointsOf(step.params.checkpoints);
    await updateLeague(owner.id, league.id, { rules: { checkpoints } });
    return `Checkpoint di ${league.alias}: ${checkpoints.map((item) => `${item.afterMatchday}/${item.changes}`).join(", ") || "nessuno"}.`;
  },

  async GRANT_DELEGATE(step, ctx) {
    const league = leagueOf(ctx, step.params.league);
    const owner = userOf(ctx, league.ownerAlias);
    const delegate = userOf(ctx, step.params.user);
    await updateLeague(owner.id, league.id, { grantDelegateUserId: delegate.id });
    return `${delegate.alias} è admin delegato di ${league.alias}.`;
  },

  async REVOKE_DELEGATE(step, ctx) {
    const league = leagueOf(ctx, step.params.league);
    const owner = userOf(ctx, league.ownerAlias);
    const delegate = userOf(ctx, step.params.user);
    await updateLeague(owner.id, league.id, { revokeDelegateUserId: delegate.id });
    return `Delega tolta a ${delegate.alias}.`;
  },

  async ASSIGN_ROSTER(step, ctx) {
    const user = userOf(ctx, step.params.user);
    ctx.teamSerial += 1;
    const playerIds = resolveRoster(ctx, step.params.players, ctx.teamSerial);
    const players = catalogOf(ctx, playerIds);
    const report = evaluateRoster(players, ctx.catalog.clubs, ctx.catalog.rules);
    if (!report.ready || report.duplicateClubs.length > 0) {
      throw new Error(`Vincolo rosa violato: ${report.duplicateClubs.map((club) => club.code).join(", ") || "ruoli o totale"}.`);
    }
    const detail = await applyRoster(ctx, user, playerIds);
    return `${user.alias}: ${playerIds.length} calciatori, un club ciascuno. ${detail}`;
  },

  async TRADE(step, ctx) {
    const from = userOf(ctx, step.params.from);
    const to = userOf(ctx, step.params.to);
    const outId = resolveRoster(ctx, step.params.out, 0)[0];
    const inId = resolveRoster(ctx, step.params.in, 0)[0];
    if (!outId || !inId) throw new Error("Lo scambio vuole i due calciatori, out e in.");
    const alias = text(step.as) || `trade-${ctx.trades.size + 1}`;
    ctx.trades.set(alias, { from: from.alias, to: to.alias, outId, inId });
    if (step.params.approved === false) return `Scambio ${alias} in attesa di approvazione. La piattaforma non ha una coda propria: resta nel runner.`;
    await handlers.APPROVE_TRADE({ ...step, params: { ...step.params, trade: alias } }, ctx);
    return `Scambio ${alias} applicato.`;
  },

  async APPROVE_TRADE(step, ctx) {
    const alias = text(step.params.trade);
    const trade = ctx.trades.get(alias);
    if (!trade) throw new Error(`Scambio sconosciuto: ${alias}.`);
    const from = userOf(ctx, trade.from);
    const to = userOf(ctx, trade.to);
    const fromIds = await currentRosterIds(ctx, from);
    const toIds = await currentRosterIds(ctx, to);
    if (!fromIds.includes(trade.outId) || !toIds.includes(trade.inId)) {
      throw new Error("I calciatori dello scambio non sono nelle rose indicate.");
    }
    const nextFrom = fromIds.map((playerId) => (playerId === trade.outId ? trade.inId : playerId));
    const nextTo = toIds.map((playerId) => (playerId === trade.inId ? trade.outId : playerId));
    for (const [label, ids] of [["da", nextFrom], ["a", nextTo]] as const) {
      const report = evaluateRoster(catalogOf(ctx, ids), ctx.catalog.clubs, ctx.catalog.rules);
      if (!report.ready || report.duplicateClubs.length > 0) {
        throw new Error(`Scambio rifiutato: la rosa ${label} viola il vincolo (${report.duplicateClubs.map((club) => club.code).join(", ") || "ruoli"}).`);
      }
    }
    await applyRoster(ctx, from, nextFrom);
    await applyRoster(ctx, to, nextTo);
    ctx.trades.delete(alias);
    return `Scambio ${alias} scritto su entrambe le rose.`;
  },

  async REJECT_TRADE(step, ctx) {
    const alias = text(step.params.trade);
    if (!ctx.trades.delete(alias)) throw new Error(`Scambio sconosciuto: ${alias}.`);
    return `Scambio ${alias} annullato. Le rose non cambiano.`;
  },

  async SUBMIT_LINEUP(step, ctx) {
    const user = userOf(ctx, step.params.user);
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const teamId = user.teamId ?? await rememberTeam(ctx, user);
    if (!teamId) throw new Error(`${user.alias} non ha una rosa.`);
    const pick = await lineupFor(ctx, user, step);
    const repeat = Math.max(1, Math.min(20, integer(step.params.repeat, 1)));
    const league = leagueFor(ctx, step, user);
    if (repeat === 1) {
      await submitOnce(ctx, user, week.id, pick, league?.id ?? null);
    } else {
      const burst = await Promise.all(Array.from({ length: repeat }, () => ctx.admin.rpc("submit_lineup", {
        p_fantasy_team_id: teamId,
        p_gameweek_id: week.id,
        p_player_ids: pick.starters,
        p_captain_id: pick.captain,
        p_vice_captain_id: pick.vice,
        p_bench_ids: pick.bench,
      })));
      const failed = burst.map((item) => item.error?.message).find(Boolean);
      if (failed && burst.every((item) => item.error)) throw new Error(failed);
    }
    const stored = await ctx.admin.from("lineups").select("id").eq("fantasy_team_id", teamId).eq("gameweek_id", week.id);
    if (stored.error) throw new Error(stored.error.message);
    const lineupId = stored.data?.[0]?.id as string | undefined;
    const slots = lineupId
      ? await ctx.admin.from("lineup_slots").select("player_id").eq("lineup_id", lineupId)
      : { data: [], error: null };
    if (slots.error) throw new Error(slots.error.message);
    if ((stored.data ?? []).length !== 1) {
      throw new Error(`Invii simultanei: ${(stored.data ?? []).length} formazioni invece di 1.`);
    }
    return `${user.alias} giornata ${week.scriptWeek}: 1 formazione, ${(slots.data ?? []).length} slot, invii ${repeat}.`;
  },

  async SKIP_LINEUP(step, ctx) {
    const user = userOf(ctx, step.params.user);
    const week = integer(step.params.week, 1);
    return `${user.alias} non invia la giornata ${week}.`;
  },

  async SET_DEADLINE(step, ctx) {
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const mode = text(step.params.at, "future");
    const deadline = mode === "past"
      ? new Date(Date.now() - 60 * 1000)
      : mode === "future"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : new Date(mode);
    if (Number.isNaN(deadline.getTime())) throw new Error("Deadline non valida. Usa future, past o una data ISO.");
    const updated = await ctx.admin.from("gameweeks").update({ deadline_at: deadline.toISOString(), status: "open" }).eq("id", week.id);
    if (updated.error) throw new Error(updated.error.message);
    return `Deadline giornata ${week.scriptWeek}: ${deadline.toISOString()}.`;
  },

  async FILE_FORGOTTEN(step, ctx) {
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const requested = playerTokens(step.params.users);
    const users = requested.length > 0
      ? requested.map((alias) => userOf(ctx, alias))
      : [...ctx.users.values()];
    const teamIds = [];
    for (const user of users) {
      const teamId = user.teamId ?? await rememberTeam(ctx, user);
      if (teamId) teamIds.push(teamId);
    }
    const filed = await fileForgottenLineups(week.id, teamIds);
    return `Fallback su ${filed} squadre alla giornata ${week.scriptWeek}.`;
  },

  async CREATE_MATCH(step, ctx) {
    const alias = text(step.as) || text(step.params.alias);
    if (!alias) throw new Error("CREATE_MATCH vuole un alias nel campo as.");
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const home = ctx.catalog.clubs.find((club) => club.code.toLowerCase() === text(step.params.home).toLowerCase());
    const away = ctx.catalog.clubs.find((club) => club.code.toLowerCase() === text(step.params.away).toLowerCase());
    if (!home || !away || home.id === away.id) throw new Error("Servono due club diversi, home e away.");
    const id = randomUUID();
    const inserted = await ctx.admin.from("real_matches").insert({
      id,
      gameweek_id: week.id,
      home_club_id: home.id,
      away_club_id: away.id,
      kickoff_at: text(step.params.kickoff) || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: "scheduled",
    });
    if (inserted.error) throw new Error(inserted.error.message);
    ctx.matches.set(alias, id);
    return `Partita ${alias}: ${home.code}-${away.code}, giornata ${week.scriptWeek}.`;
  },

  async LOAD_VOTES(step, ctx) {
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const fileText = text(step.params.text);
    let rows: { playerId: string; voto: number | null; goals: number; assists: number; postponed: boolean }[] = [];
    if (fileText) {
      const feed = parseEmergencyVotes(fileText, text(step.params.fileName, "scenario.csv"));
      const codes = feed.votes.map((vote) => vote.externalRef);
      const found = await ctx.admin.from("players").select("id, external_ref").in("external_ref", codes);
      if (found.error) throw new Error(found.error.message);
      const ids = new Map((found.data ?? []).map((row) => [row.external_ref as string, row.id as string]));
      const missing = codes.filter((code) => !ids.has(code));
      if (missing.length > 0) throw new Error(`Codici assenti dal listone: ${missing.slice(0, 8).join(", ")}. Nessun voto salvato.`);
      rows = feed.votes.map((vote) => ({
        playerId: ids.get(vote.externalRef) as string,
        voto: vote.voto,
        goals: vote.goals,
        assists: vote.assists,
        postponed: false,
      }));
    } else if (Array.isArray(step.params.rows)) {
      rows = step.params.rows.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { club?: unknown; player?: unknown; voto?: unknown; goals?: unknown; assists?: unknown; postponed?: unknown };
        const playerId = resolveRoster(ctx, row.player ?? row.club, 0)[0];
        if (!playerId) return [];
        return [{
          playerId,
          voto: row.voto == null || row.voto === "" ? null : Number(row.voto),
          goals: integer(row.goals, 0),
          assists: integer(row.assists, 0),
          postponed: row.postponed === true,
        }];
      });
    }
    if (rows.length === 0) throw new Error("LOAD_VOTES vuole text CSV oppure rows.");
    const imported = await ctx.admin.from("vote_imports").insert({
      id: randomUUID(),
      gameweek_id: week.id,
      source: "scenario-script",
      source_note: "Scenario runner",
      payload_hash: `scenario-${week.id}-${randomUUID()}`,
    }).select("id").single();
    if (imported.error || !imported.data) throw new Error(imported.error?.message ?? "Import non creato.");
    const playerIds = rows.map((row) => row.playerId);
    await ctx.admin.from("player_gameweek_stats").delete().eq("gameweek_id", week.id).in("player_id", playerIds);
    const saved = await ctx.admin.from("player_gameweek_stats").insert(rows.map((row) => ({
      id: randomUUID(),
      gameweek_id: week.id,
      player_id: row.playerId,
      vote_import_id: imported.data.id as string,
      voto: row.voto,
      goals: row.goals,
      assists: row.assists,
      yellow_cards: 0,
      red_cards: 0,
      penalties_scored: 0,
      penalties_missed: 0,
      penalties_saved: 0,
      own_goals: 0,
      goals_conceded: 0,
      postponed: row.postponed,
    })));
    if (saved.error) throw new Error(saved.error.message);
    return `${rows.length} voti sulla giornata ${week.scriptWeek}. Il calcolo è un passo SCORE a parte.`;
  },

  async LIVE_SCORE(step, ctx) {
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const live = await refreshProvisionalScores(week.id);
    return live.skipped
      ? `Live giornata ${week.scriptWeek} non scritto: la giornata è già calcolata.`
      : `Proiezione live su ${live.teams} squadre. Il totale ufficiale resta fermo.`;
  },

  async SCORE(step, ctx) {
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const teamIds = [];
    for (const user of ctx.users.values()) {
      const teamId = user.teamId ?? await rememberTeam(ctx, user);
      if (teamId) teamIds.push(teamId);
    }
    if (teamIds.length === 0) throw new Error("Non ci sono squadre di scenario da calcolare.");
    const first = await scoreOfficialGameweek(week.id, { teamIds });
    if (first.skipped) throw new Error(first.reason ?? "Calcolo saltato.");
    const times = Math.max(1, Math.min(5, integer(step.params.times, 1)));
    if (times === 1) return `Giornata ${week.scriptWeek} calcolata su ${first.teams} squadre.`;
    await ctx.admin.from("gameweeks").update({ status: "scored" }).eq("id", week.id);
    const before = await fingerprint(ctx, week.id, teamIds);
    const second = await scoreOfficialGameweek(week.id, { allowRewrite: true, teamIds });
    const after = await fingerprint(ctx, week.id, teamIds);
    const delta = totalsDelta(before.totals.map((row) => row.total), after.totals.map((row) => row.total));
    const same = before.rows.join("|") === after.rows.join("|");
    if (second.skipped || delta !== 0 || !same || after.duplicates !== 0) {
      throw new Error(`Idempotenza fallita. Delta ${delta}. Duplicati ${after.duplicates}.`);
    }
    return `Giornata ${week.scriptWeek} calcolata ${times} volte. Delta 0, nessuna riga duplicata.`;
  },

  async POSTPONE_MATCH(step, ctx) {
    const alias = text(step.params.match);
    const matchId = ctx.matches.get(alias);
    if (!matchId) throw new Error(`Partita di scenario sconosciuta: ${alias}.`);
    const postponed = step.params.postponed !== false;
    await setMatchPostponed(matchId, postponed);
    return postponed ? `${alias} rinviata: quei voti non entrano nel calcolo.` : `${alias} di nuovo in calendario.`;
  },

  async RECALC(step, ctx) {
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const result = await recalculateExtraordinary(week.id);
    return `Ricalcolo giornata ${week.scriptWeek}: ${result.teams} squadre, bacheca ${result.board}.`;
  },

  async ASSERT_SCORE(step, ctx) {
    const user = userOf(ctx, step.params.user);
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const teamId = user.teamId ?? await rememberTeam(ctx, user);
    if (!teamId) throw new Error(`${user.alias} non ha una squadra.`);
    const column = text(step.params.column, "total") === "provisional" ? "provisional_total" : "total";
    const score = await ctx.admin
      .from("team_gameweek_scores")
      .select("total, provisional_total")
      .eq("fantasy_team_id", teamId)
      .eq("gameweek_id", week.id)
      .maybeSingle();
    if (score.error) throw new Error(score.error.message);
    const actual = Number(score.data?.[column] ?? NaN);
    const expected = Number(step.params.total);
    const tolerance = Number(step.params.tolerance ?? 0);
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
      throw new Error(`${user.alias} giornata ${week.scriptWeek}: atteso ${expected}, trovato ${Number.isFinite(actual) ? actual : "nessun punteggio"}.`);
    }
    return `${user.alias} giornata ${week.scriptWeek}: ${actual}.`;
  },

  async ASSERT_RANKING(step, ctx) {
    const league = leagueOf(ctx, step.params.league);
    const settings = await readLeagueSettings(ctx.admin, league.id);
    const members = await ctx.admin.from("private_league_members").select("fantasy_team_id").eq("private_league_id", league.id);
    if (members.error) throw new Error(members.error.message);
    const teamIds = (members.data ?? []).map((row) => row.fantasy_team_id as string);
    const aliasByTeam = new Map([...ctx.users.values()].flatMap((user) => user.teamId ? [[user.teamId, user.alias] as const] : []));
    const weekRows = [...ctx.weeks.values()];
    let scores: { fantasy_team_id: string; gameweek_id: string; total: number | string | null }[] = [];
    if (weekRows.length > 0 && teamIds.length > 0) {
      const loaded = await ctx.admin
        .from("team_gameweek_scores")
        .select("fantasy_team_id, gameweek_id, total")
        .in("fantasy_team_id", teamIds)
        .in("gameweek_id", weekRows.map((week) => week.id));
      if (loaded.error) throw new Error(loaded.error.message);
      scores = loaded.data ?? [];
    }
    const points = new Map<string, number>();
    for (const teamId of teamIds) points.set(teamId, 0);
    for (const week of weekRows) {
      const scriptWeek = week.sandbox - SANDBOX_WEEK_BASE;
      const mode = weekScoreMode(settings.rules, scriptWeek);
      const fantasy = new Map(teamIds.map((teamId) => {
        const row = scores.find((item) => item.fantasy_team_id === teamId && item.gameweek_id === week.id);
        return [teamId, Number(row?.total ?? 0)] as const;
      }));
      if (mode === "head_to_head") {
        for (const [teamId, awarded] of headToHeadPoints(teamIds, scriptWeek, fantasy, settings.rules.goalBands)) {
          points.set(teamId, (points.get(teamId) ?? 0) + awarded);
        }
      } else if (mode === "sum") {
        for (const [teamId, value] of fantasy) points.set(teamId, (points.get(teamId) ?? 0) + value);
      }
    }
    const ranking = [...points.entries()]
      .map(([teamId, value]) => ({ alias: aliasByTeam.get(teamId) ?? teamId, points: value }))
      .sort((left, right) => right.points - left.points || left.alias.localeCompare(right.alias));
    const expected = text(step.params.order).split(/[,|]/).map((item) => item.trim()).filter(Boolean);
    const actual = ranking.map((row) => row.alias);
    if (expected.length > 0 && actual.join(",") !== expected.join(",")) {
      throw new Error(`Classifica attesa ${expected.join(", ")}. Trovata ${actual.join(", ") || "vuota"}.`);
    }
    return ranking.map((row, index) => `${index + 1}. ${row.alias} ${row.points}`).join("; ") || "Classifica vuota.";
  },

  async ASSERT_ERROR(_step, ctx) {
    const contains = text(_step.params.contains);
    if (!ctx.lastError || (contains && !ctx.lastError.toLowerCase().includes(contains.toLowerCase()))) {
      throw new Error(`Errore atteso «${contains || "qualunque"}». Ultimo errore: ${ctx.lastError ?? "nessuno"}.`);
    }
    return `Errore confermato: ${ctx.lastError}`;
  },

  async ASSERT_CONSTRAINT(step, ctx) {
    const user = userOf(ctx, step.params.user);
    const ids = await currentRosterIds(ctx, user);
    const report = evaluateRoster(catalogOf(ctx, ids), ctx.catalog.clubs, ctx.catalog.rules);
    const ok = step.params.ok !== false;
    if (ok && (!report.ready || report.duplicateClubs.length > 0)) {
      throw new Error(`La rosa di ${user.alias} non è valida.`);
    }
    if (!ok && report.ready && report.duplicateClubs.length === 0) {
      throw new Error(`La rosa di ${user.alias} rispetta i vincoli, ma il passo aspettava una violazione.`);
    }
    return ok
      ? `Rosa di ${user.alias} valida.`
      : `Violazione confermata su ${user.alias}: ${report.duplicateClubs.map((club) => club.code).join(", ") || "ruoli o totale"}.`;
  },

  async ASSERT_LINEUP_COUNT(step, ctx) {
    const user = userOf(ctx, step.params.user);
    const week = await ensureWeek(ctx, step.params.week ?? 1);
    const teamId = user.teamId ?? await rememberTeam(ctx, user);
    if (!teamId) throw new Error(`${user.alias} non ha una squadra.`);
    const stored = await ctx.admin.from("lineups").select("id").eq("fantasy_team_id", teamId).eq("gameweek_id", week.id);
    if (stored.error) throw new Error(stored.error.message);
    const lineupId = stored.data?.[0]?.id as string | undefined;
    const slots = lineupId
      ? await ctx.admin.from("lineup_slots").select("player_id").eq("lineup_id", lineupId)
      : { data: [], error: null };
    if (slots.error) throw new Error(slots.error.message);
    const lineups = stored.data?.length ?? 0;
    const slotCount = slots.data?.length ?? 0;
    const expectedLineups = integer(step.params.lineups, 1);
    const expectedSlots = step.params.slots == null ? null : integer(step.params.slots, 0);
    if (lineups !== expectedLineups || (expectedSlots != null && slotCount !== expectedSlots)) {
      throw new Error(`Formazioni ${lineups} (attese ${expectedLineups}), slot ${slotCount}${expectedSlots == null ? "" : ` (attesi ${expectedSlots})`}.`);
    }
    return `${user.alias}: ${lineups} formazione, ${slotCount} slot.`;
  },
};

const missingActions = SCENARIO_ACTIONS.filter((spec) => !handlers[spec.action]);
if (missingActions.length > 0) {
  throw new Error(`Dizionario senza handler: ${missingActions.map((spec) => spec.action).join(", ")}.`);
}

function accepts(detail: string, expectError: string) {
  return detail.toLowerCase().includes(expectError.toLowerCase());
}

export async function runScenario(script: ScenarioScript): Promise<ScenarioReport> {
  const admin = createAdminSupabase();
  const steps: ScenarioStepReport[] = [];
  let seasonId = "";
  let removed = false;
  try {
    const season = await getCurrentSeason(admin);
    seasonId = season.id;
    await wipeScenario(admin, seasonId);
    const catalog = await loadCatalog(season.id);
    const ctx: RunContext = {
      admin,
      seasonId,
      catalog,
      users: new Map(),
      leagues: new Map(),
      weeks: new Map(),
      matches: new Map(),
      trades: new Map(),
      actor: null,
      lastError: null,
      teamSerial: 0,
    };
    for (const [index, step] of script.steps.entries()) {
      const handler = handlers[step.action];
      try {
        if (!handler) throw new Error(`Azione ${step.action} fuori dal dizionario.`);
        const detail = await handler(step, ctx);
        if (step.expectError) {
          ctx.lastError = null;
          steps.push({
            index: index + 1,
            action: step.action,
            passed: false,
            detail: `Il passo doveva fallire con «${step.expectError}», invece è riuscito. ${detail}`,
          });
        } else {
          ctx.lastError = null;
          steps.push({ index: index + 1, action: step.action, passed: true, detail });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Passo interrotto.";
        ctx.lastError = message;
        const passed = Boolean(step.expectError && accepts(message, step.expectError));
        steps.push({
          index: index + 1,
          action: step.action,
          passed,
          detail: passed ? `Errore atteso: ${message}` : message,
        });
      }
    }
  } catch (error) {
    steps.push({
      index: steps.length + 1,
      action: "SANDBOX",
      passed: false,
      detail: error instanceof Error ? error.message : "Scenario non partito.",
    });
  } finally {
    if (seasonId) {
      try {
        await wipeScenario(admin, seasonId);
        removed = true;
      } catch (error) {
        steps.push({
          index: steps.length + 1,
          action: "PULIZIA",
          passed: false,
          detail: error instanceof Error ? error.message : "Sandbox non rimossa.",
        });
      }
    }
  }
  const report = {
    name: script.name,
    passed: steps.length > 0 && steps.every((step) => step.passed),
    steps,
    narrative: "",
    sandboxRemoved: removed,
  };
  report.narrative = scenarioNarrative(report);
  return report;
}
