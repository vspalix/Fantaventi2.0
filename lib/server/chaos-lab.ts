import { randomUUID } from "node:crypto";
import { TEST_TEAM_PASSWORD } from "@/lib/admin-types";
import { totalsDelta } from "@/lib/chaos/delta";
import { evaluateRoster } from "@/lib/constraints";
import { autoLineup } from "@/lib/formations";
import { headToHeadPoints, parseLeagueRules } from "@/lib/league-rules";
import { ensureProfile, getCurrentSeason, loadCatalog } from "@/lib/server/catalog";
import { fileForgottenLineups } from "@/lib/server/forgotten-lineup";
import { scoreOfficialGameweek } from "@/lib/server/live-score";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { CatalogPlayer, ClubRef, PlayerRole, RosterRules } from "@/lib/types";

const WEEKS = [901, 902] as const;
const TEAM_COUNT = 15;
const ROLES: PlayerRole[] = ["GK", "DEF", "MID", "FWD"];

export type ChaosStep = { name: string; passed: boolean; detail: string };

export type ChaosReport = {
  passed: boolean;
  steps: ChaosStep[];
  sandboxRemoved: boolean;
};

type Admin = ReturnType<typeof createAdminSupabase>;

function fail(message: string): never {
  throw new Error(message);
}

async function findOrCreateChaosUser(admin: Admin, email: string) {
  const created = await admin.auth.admin.createUser({
    email,
    password: TEST_TEAM_PASSWORD,
    email_confirm: true,
  });
  if (!created.error && created.data.user) return created.data.user.id;
  const message = created.error?.message ?? "";
  if (!/already|registered|exists|già/i.test(message)) fail(message || `Impossibile creare ${email}.`);
  for (let page = 1; page <= 10; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) fail(listed.error.message);
    const found = listed.data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found.id;
    if (listed.data.users.length < 200) break;
  }
  fail(`L'utente ${email} esiste già e non è stato recuperato.`);
}

function takeRole(pool: CatalogPlayer[], role: PlayerRole, teamIndex: number) {
  const matching = pool.filter((player) => player.role === role);
  if (matching.length === 0) return null;
  return matching[teamIndex % matching.length] ?? null;
}

function chaosRoster(
  players: CatalogPlayer[],
  clubs: ClubRef[],
  rules: RosterRules,
  teamIndex: number,
) {
  const byClub = new Map<string, CatalogPlayer[]>();
  for (const player of players) {
    const list = byClub.get(player.clubId) ?? [];
    list.push(player);
    byClub.set(player.clubId, list);
  }
  const ordered = [...clubs].sort((left, right) => left.code.localeCompare(right.code));
  const rotated = ordered.map((_, index) => ordered[(index + teamIndex) % ordered.length]).filter((club) => club !== undefined);
  if (rules.squadSize !== clubs.length) {
    fail(`Il listone ha ${clubs.length} club e il regolamento ne prevede ${rules.squadSize}.`);
  }
  const picked: CatalogPlayer[] = [];
  if (rules.squadSize !== 20) {
    for (const club of rotated) {
      const pool = byClub.get(club.id) ?? [];
      const choice = pool[teamIndex % Math.max(pool.length, 1)];
      if (!choice) fail(`Manca un calciatore per ${club.code}.`);
      picked.push(choice);
    }
  } else {
    const remaining: Record<PlayerRole, number> = { GK: 3, DEF: 6, MID: 6, FWD: 5 };
    const rest = [...rotated];
    for (const role of ROLES) {
      let need = remaining[role];
      for (let index = 0; index < rest.length && need > 0;) {
        const club = rest[index];
        if (!club) break;
        const choice = takeRole(byClub.get(club.id) ?? [], role, teamIndex);
        if (!choice) {
          index += 1;
          continue;
        }
        picked.push(choice);
        rest.splice(index, 1);
        need -= 1;
      }
      if (need > 0) fail(`Non trovo ${need} ${role} nel listone della competizione.`);
    }
  }
  const report = evaluateRoster(picked, clubs, rules);
  if (!report.ready || report.duplicateClubs.length > 0) {
    fail(`Rosa Chaos ${teamIndex + 1} non valida.`);
  }
  return picked;
}

function spareSwap(roster: CatalogPlayer[], players: CatalogPlayer[]) {
  for (const current of roster) {
    const spare = players.find((player) => (
      player.clubId === current.clubId && player.id !== current.id && player.role === current.role
    ));
    if (!spare) continue;
    return { next: roster.map((player) => (player.id === current.id ? spare : player)), outId: current.id, inId: spare.id };
  }
  return null;
}

async function wipeSandbox(admin: Admin, seasonId: string) {
  const weeks = await admin.from("gameweeks").select("id").eq("season_id", seasonId).in("number", [...WEEKS]);
  const weekIds = (weeks.data ?? []).map((row) => row.id as string);
  const teams = await admin.from("fantasy_teams").select("id").eq("season_id", seasonId).ilike("name", "Chaos Lab %");
  const teamIds = (teams.data ?? []).map((row) => row.id as string);
  const leagues = await admin.from("private_leagues").select("id").eq("season_id", seasonId).eq("name", "Chaos Lab");
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
    await admin.from("gameweeks").delete().in("id", weekIds);
  }
  if (leagueIds.length > 0) await admin.from("private_league_members").delete().in("private_league_id", leagueIds);
  if (teamIds.length > 0) await admin.from("roster_stints").delete().in("fantasy_team_id", teamIds);
  if (leagueIds.length > 0) await admin.from("private_leagues").delete().in("id", leagueIds);
  if (teamIds.length > 0) await admin.from("fantasy_teams").delete().in("id", teamIds);
}

async function fingerprint(admin: Admin, gameweekId: string, teamIds: string[]) {
  const scores = await admin
    .from("team_gameweek_scores")
    .select("fantasy_team_id, total")
    .eq("gameweek_id", gameweekId)
    .in("fantasy_team_id", teamIds);
  if (scores.error) fail(scores.error.message);
  const players = await admin
    .from("lineup_player_scores")
    .select("fantasy_team_id, player_id, player_points")
    .eq("gameweek_id", gameweekId)
    .in("fantasy_team_id", teamIds);
  if (players.error) fail(players.error.message);
  const totals = (scores.data ?? [])
    .map((row) => ({ id: row.fantasy_team_id as string, total: Number(row.total) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const rows = (players.data ?? []).map((row) => (
    `${row.fantasy_team_id}:${row.player_id}:${Number(row.player_points)}`
  )).sort();
  const unique = new Set((players.data ?? []).map((row) => `${row.fantasy_team_id}:${row.player_id}`));
  return { totals, rows, duplicates: rows.length - unique.size };
}

async function writeVotes(
  admin: Admin,
  gameweekId: string,
  playerIds: string[],
  boosted: { playerId: string; goals: number; voto: number } | null,
) {
  const imported = await admin.from("vote_imports").insert({
    id: randomUUID(),
    gameweek_id: gameweekId,
    source: "chaos-lab",
    source_note: "Laboratorio caos",
    payload_hash: `chaos-${gameweekId}`,
  }).select("id").single();
  if (imported.error || !imported.data) fail(imported.error?.message ?? "Import voti non creato.");
  const rows = [...new Set(playerIds)].map((playerId) => ({
    id: randomUUID(),
    gameweek_id: gameweekId,
    player_id: playerId,
    vote_import_id: imported.data.id as string,
    voto: boosted?.playerId === playerId ? boosted.voto : 6,
    goals: boosted?.playerId === playerId ? boosted.goals : 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    penalties_scored: 0,
    penalties_missed: 0,
    penalties_saved: 0,
    own_goals: 0,
    goals_conceded: 0,
    postponed: false,
  }));
  for (let index = 0; index < rows.length; index += 200) {
    const slice = rows.slice(index, index + 200);
    const { error } = await admin.from("player_gameweek_stats").insert(slice);
    if (error) fail(error.message);
  }
}

export async function runChaosTest(ownerUserId: string): Promise<ChaosReport> {
  const steps: ChaosStep[] = [];
  const note = (name: string, passed: boolean, detail: string) => steps.push({ name, passed, detail });
  const admin = createAdminSupabase();
  let seasonId = "";
  let removed = false;

  try {
    const season = await getCurrentSeason(admin);
    seasonId = season.id;
    const catalog = await loadCatalog(season.id);
    await wipeSandbox(admin, seasonId);

    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const weekIds = new Map<number, string>();
    for (const number of WEEKS) {
      const id = randomUUID();
      const { error } = await admin.from("gameweeks").insert({
        id,
        season_id: seasonId,
        number,
        deadline_at: deadline,
        status: "open",
      });
      if (error) fail(error.message);
      weekIds.set(number, id);
    }
    const firstWeek = weekIds.get(901) ?? fail("Giornata 901 mancante.");
    const secondWeek = weekIds.get(902) ?? fail("Giornata 902 mancante.");

    const rules = parseLeagueRules({
      format: "classic",
      missedLineup: "carry",
      checkpoints: [{ afterMatchday: 901, changes: 3 }],
    });
    const leagueId = randomUUID();
    const joinCode = `C${randomUUID().slice(0, 6).toUpperCase()}`;
    const leagueRow = {
      id: leagueId,
      season_id: seasonId,
      owner_user_id: ownerUserId,
      name: "Chaos Lab",
      join_code: joinCode,
      settings: rules,
    };
    const createdLeague = await admin.from("private_leagues").insert({
      ...leagueRow,
      competition_format: "classic",
    });
    if (createdLeague.error && /competition_format|schema cache|could not find/i.test(createdLeague.error.message)) {
      const retry = await admin.from("private_leagues").insert(leagueRow);
      if (retry.error) fail(retry.error.message);
    } else if (createdLeague.error) {
      fail(createdLeague.error.message);
    }

    const squads: { teamId: string; roster: CatalogPlayer[] }[] = [];
    for (let index = 0; index < TEAM_COUNT; index += 1) {
      const email = `chaos-${String(index + 1).padStart(2, "0")}@fantaventi.test`;
      const userId = await findOrCreateChaosUser(admin, email);
      await ensureProfile(admin, userId, email);
      const teamId = randomUUID();
      const { error: teamError } = await admin.from("fantasy_teams").insert({
        id: teamId,
        user_id: userId,
        season_id: seasonId,
        name: `Chaos Lab ${String(index + 1).padStart(2, "0")}`,
      });
      if (teamError) fail(teamError.message);
      const roster = chaosRoster(catalog.players, catalog.clubs, catalog.rules, index);
      const { error: stintError } = await admin.from("roster_stints").insert(roster.map((player) => ({
        id: randomUUID(),
        fantasy_team_id: teamId,
        player_id: player.id,
        active_from_gameweek: 1,
        active_until_gameweek: null,
      })));
      if (stintError) fail(stintError.message);
      const { error: memberError } = await admin.from("private_league_members").insert({
        private_league_id: leagueId,
        fantasy_team_id: teamId,
      });
      if (memberError) fail(memberError.message);
      squads.push({ teamId, roster });
    }
    note(
      "Rose",
      squads.length === TEAM_COUNT,
      `${squads.length} rose su ${catalog.clubs.length} club della competizione ${season.competitionCode}. Un calciatore per club.`,
    );

    const filed = squads.slice(0, 10);
    const silent = squads.slice(10);
    const lineups = filed.map((squad) => {
      const lineup = autoLineup(squad.roster);
      if (!lineup?.captainId || !lineup.viceId) fail("Modulo non disponibile.");
      return { ...squad, lineup };
    });
    for (const squad of lineups) {
      const { error } = await admin.rpc("submit_lineup", {
        p_fantasy_team_id: squad.teamId,
        p_gameweek_id: firstWeek,
        p_player_ids: squad.lineup.playerIds,
        p_captain_id: squad.lineup.captainId,
        p_vice_captain_id: squad.lineup.viceId,
        p_bench_ids: squad.lineup.benchIds,
      });
      if (error) fail(error.message);
    }

    const probe = lineups[0];
    if (!probe) fail("Nessuna formazione di prova.");
    const burst = await Promise.all(Array.from({ length: 8 }, () => admin.rpc("submit_lineup", {
      p_fantasy_team_id: probe.teamId,
      p_gameweek_id: firstWeek,
      p_player_ids: probe.lineup.playerIds,
      p_captain_id: probe.lineup.captainId,
      p_vice_captain_id: probe.lineup.viceId,
      p_bench_ids: probe.lineup.benchIds,
    })));
    const burstErrors = burst.map((item) => item.error?.message).filter((message): message is string => Boolean(message));
    const stored = await admin.from("lineups").select("id").eq("fantasy_team_id", probe.teamId).eq("gameweek_id", firstWeek);
    if (stored.error) fail(stored.error.message);
    const lineupId = stored.data?.[0]?.id as string | undefined;
    const slots = lineupId
      ? await admin.from("lineup_slots").select("player_id").eq("lineup_id", lineupId)
      : { data: [], error: null };
    if (slots.error) fail(slots.error.message);
    const expectedSlots = probe.roster.length;
    const concurrencyOk = (stored.data ?? []).length === 1 && (slots.data ?? []).length === expectedSlots;
    note(
      "Concorrenza",
      concurrencyOk,
      concurrencyOk
        ? "8 invii simultanei, una sola formazione e nessuno slot duplicato."
        : `Formazioni ${(stored.data ?? []).length}, slot ${(slots.data ?? []).length} attesi ${expectedSlots}. ${burstErrors[0] ?? "Esegui lineup_lock.sql e poi di nuovo league_hub.sql."}`,
    );

    const forgotten = await fileForgottenLineups(firstWeek, silent.map((squad) => squad.teamId));
    const silentRows = await admin
      .from("lineups")
      .select("id")
      .eq("gameweek_id", firstWeek)
      .in("fantasy_team_id", silent.map((squad) => squad.teamId));
    if (silentRows.error) fail(silentRows.error.message);
    note(
      "Formazioni mancanti",
      forgotten === silent.length && (silentRows.data ?? []).length === silent.length,
      `${forgotten} squadre senza invio: formazione alfabetica d'ufficio sulla prima giornata di test.`,
    );

    const captainId = probe.lineup.captainId;
    if (!captainId) fail("Capitano mancante.");
    const everyone = squads.flatMap((squad) => squad.roster.map((player) => player.id));
    await writeVotes(admin, firstWeek, everyone, { playerId: captainId, goals: 1, voto: 7 });
    const teamIds = squads.map((squad) => squad.teamId);
    const first = await scoreOfficialGameweek(firstWeek, { teamIds });
    if (first.skipped) fail(first.reason ?? "Calcolo giornata 1 saltato.");
    const bonus = await admin
      .from("lineup_player_scores")
      .select("bonus_points, is_effective_captain")
      .eq("gameweek_id", firstWeek)
      .eq("fantasy_team_id", probe.teamId)
      .eq("player_id", captainId)
      .maybeSingle();
    if (bonus.error) fail(bonus.error.message);
    const teamScore = await admin
      .from("team_gameweek_scores")
      .select("fantasy_team_id, total, captain_modifier, defense_modifier")
      .eq("gameweek_id", firstWeek)
      .in("fantasy_team_id", teamIds);
    if (teamScore.error) fail(teamScore.error.message);
    const totals = new Map((teamScore.data ?? []).map((row) => [row.fantasy_team_id as string, Number(row.total)]));
    const h2h = [...headToHeadPoints(teamIds, 901, totals).values()];
    const modifiersOk = (teamScore.data ?? []).every((row) => (
      Number.isFinite(Number(row.captain_modifier)) && Number.isFinite(Number(row.defense_modifier))
    ));
    const h2hOk = h2h.length === TEAM_COUNT && h2h.every((points) => points === 0 || points === 1 || points === 3);
    note(
      "Giornata 1",
      modifiersOk && h2hOk && totals.size === TEAM_COUNT && Number(bonus.data?.bonus_points) > 0 && Boolean(bonus.data?.is_effective_captain),
      `Capitano con gol: bonus ${bonus.data?.bonus_points ?? "—"}. Classico su ${totals.size} squadre, H2H ${h2h.join(", ")}.`,
    );

    await admin.from("gameweeks").update({ status: "scored" }).eq("id", firstWeek);
    const before = await fingerprint(admin, firstWeek, teamIds);
    const rewrite = await scoreOfficialGameweek(firstWeek, { allowRewrite: true, teamIds });
    const after = await fingerprint(admin, firstWeek, teamIds);
    const delta = totalsDelta(before.totals.map((row) => row.total), after.totals.map((row) => row.total));
    const sameRows = before.rows.join("|") === after.rows.join("|");
    const changed = before.totals.filter((row, index) => row.total !== after.totals[index]?.total).map((row) => row.id);
    note(
      "Idempotenza giornata 1",
      !rewrite.skipped && delta === 0 && sameRows && before.duplicates === 0 && after.duplicates === 0,
      delta === 0 && sameRows
        ? "Secondo calcolo: delta 0 e nessuna riga duplicata."
        : `Delta ${delta}. Duplicati ${after.duplicates}. Squadre diverse: ${changed.join(", ") || "conteggio righe"}.`,
    );

    let swaps = 0;
    for (const squad of squads) {
      const change = spareSwap(squad.roster, catalog.players);
      if (!change) continue;
      const report = evaluateRoster(change.next, catalog.clubs, catalog.rules);
      if (!report.ready || report.duplicateClubs.length > 0) fail("Il cambio di mercato ha rotto il vincolo di un calciatore per club.");
      const closed = await admin
        .from("roster_stints")
        .update({ active_until_gameweek: 901 })
        .eq("fantasy_team_id", squad.teamId)
        .eq("player_id", change.outId);
      if (closed.error) fail(closed.error.message);
      const opened = await admin.from("roster_stints").insert({
        id: randomUUID(),
        fantasy_team_id: squad.teamId,
        player_id: change.inId,
        active_from_gameweek: 902,
        active_until_gameweek: null,
      });
      if (opened.error) fail(opened.error.message);
      squad.roster = change.next;
      swaps += 1;
    }
    note(
      "Checkpoint",
      swaps === TEAM_COUNT,
      swaps === TEAM_COUNT
        ? `${swaps} cambi, un calciatore per club ancora rispettato.`
        : `${swaps} cambi su ${TEAM_COUNT}. Il listone non ha un ricambio dello stesso ruolo nello stesso club.`,
    );

    const nextPlayers = squads.flatMap((squad) => squad.roster.map((player) => player.id));
    await writeVotes(admin, secondWeek, nextPlayers, null);
    const second = await scoreOfficialGameweek(secondWeek, { teamIds });
    if (second.skipped) fail(second.reason ?? "Calcolo giornata 2 saltato.");
    await admin.from("gameweeks").update({ status: "scored" }).eq("id", secondWeek);
    const beforeSecond = await fingerprint(admin, secondWeek, teamIds);
    const rewriteSecond = await scoreOfficialGameweek(secondWeek, { allowRewrite: true, teamIds });
    const afterSecond = await fingerprint(admin, secondWeek, teamIds);
    const deltaSecond = totalsDelta(
      beforeSecond.totals.map((row) => row.total),
      afterSecond.totals.map((row) => row.total),
    );
    note(
      "Giornata 2",
      !rewriteSecond.skipped && deltaSecond === 0 && beforeSecond.rows.join("|") === afterSecond.rows.join("|") && afterSecond.duplicates === 0,
      deltaSecond === 0
        ? "Ricalcolo forzato della giornata 2: delta 0. Le squadre senza nuovo invio usano la formazione precedente."
        : `Delta giornata 2: ${deltaSecond}.`,
    );
  } catch (error) {
    note("Esecuzione", false, error instanceof Error ? error.message : "Test caos interrotto.");
  } finally {
    if (seasonId) {
      try {
        await wipeSandbox(admin, seasonId);
        removed = true;
      } catch (error) {
        note("Pulizia", false, error instanceof Error ? error.message : "Sandbox non rimossa.");
      }
    }
  }

  return {
    passed: steps.length > 0 && steps.every((step) => step.passed),
    steps,
    sandboxRemoved: removed,
  };
}
