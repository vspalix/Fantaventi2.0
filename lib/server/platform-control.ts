import { parseLeagueRules } from "@/lib/league-rules";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type PlatformLeagueRow = {
  id: string;
  name: string;
  joinCode: string;
  seasonCode: string;
  ownerName: string;
  format: string;
  members: number;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export async function listPlatformLeagues(): Promise<PlatformLeagueRow[]> {
  const admin = createAdminSupabase();
  const extended = await admin
    .from("private_leagues")
    .select("id, name, join_code, owner_user_id, season_id, competition_format, settings")
    .order("name");
  const plain = extended.error && /competition_format|settings|schema cache|could not find/i.test(extended.error.message)
    ? await admin.from("private_leagues").select("id, name, join_code, owner_user_id, season_id").order("name")
    : extended;
  if (plain.error) throw new Error(plain.error.message);
  const rows = plain.data ?? [];
  const seasonIds = [...new Set(rows.map((row) => row.season_id as string))];
  const ownerIds = [...new Set(rows.map((row) => row.owner_user_id as string))];
  const leagueIds = rows.map((row) => row.id as string);
  const seasons = seasonIds.length
    ? await admin.from("seasons").select("id, code").in("id", seasonIds)
    : { data: [], error: null };
  if (seasons.error) throw new Error(seasons.error.message);
  const owners = ownerIds.length
    ? await admin.from("profiles").select("id, display_name").in("id", ownerIds)
    : { data: [], error: null };
  if (owners.error) throw new Error(owners.error.message);
  const members = leagueIds.length
    ? await admin.from("private_league_members").select("private_league_id").in("private_league_id", leagueIds)
    : { data: [], error: null };
  if (members.error) throw new Error(members.error.message);
  const seasonCode = new Map((seasons.data ?? []).map((row) => [row.id as string, row.code as string]));
  const ownerName = new Map((owners.data ?? []).map((row) => [row.id as string, row.display_name as string]));
  const memberCount = new Map<string, number>();
  for (const row of members.data ?? []) {
    const id = row.private_league_id as string;
    memberCount.set(id, (memberCount.get(id) ?? 0) + 1);
  }
  return rows.map((row) => {
    const settings = "settings" in row ? row.settings : null;
    const format = "competition_format" in row && typeof row.competition_format === "string"
      ? row.competition_format
      : parseLeagueRules(settings).format;
    return {
      id: row.id as string,
      name: row.name as string,
      joinCode: row.join_code as string,
      seasonCode: seasonCode.get(row.season_id as string) ?? "",
      ownerName: ownerName.get(row.owner_user_id as string) ?? "Allenatore",
      format,
      members: memberCount.get(row.id as string) ?? 0,
    };
  });
}

export async function unlockLeagueLineups(leagueId: string, gameweekId: string) {
  const admin = createAdminSupabase();
  const league = await admin.from("private_leagues").select("season_id").eq("id", leagueId).maybeSingle();
  if (league.error) throw new Error(league.error.message);
  if (!league.data) throw httpError("Lega non trovata.", 404);
  const week = await admin
    .from("gameweeks")
    .select("id, number, status, season_id")
    .eq("id", gameweekId)
    .eq("season_id", league.data.season_id as string)
    .maybeSingle();
  if (week.error) throw new Error(week.error.message);
  if (!week.data) throw httpError("Giornata non trovata in questa stagione.", 404);
  if (week.data.status === "scored" || week.data.status === "final") {
    throw httpError("La giornata è già calcolata. Nel laboratorio annulla il calcolo prima di riaprire le formazioni.", 409);
  }
  if (week.data.status === "locked") {
    const reopened = await admin.from("gameweeks").update({ status: "open" }).eq("id", gameweekId);
    if (reopened.error) throw new Error(reopened.error.message);
  }
  const lineups = await admin
    .from("lineups")
    .update({ status: "draft", locked_at: null })
    .eq("gameweek_id", gameweekId)
    .select("id");
  if (lineups.error && /locked_at/i.test(lineups.error.message)) {
    const retry = await admin.from("lineups").update({ status: "draft" }).eq("gameweek_id", gameweekId).select("id");
    if (retry.error) throw new Error(retry.error.message);
    return { gameweekNumber: week.data.number as number, lineups: retry.data?.length ?? 0 };
  }
  if (lineups.error) throw new Error(lineups.error.message);
  return { gameweekNumber: week.data.number as number, lineups: lineups.data?.length ?? 0 };
}
