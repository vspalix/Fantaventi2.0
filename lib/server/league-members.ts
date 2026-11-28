import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRows } from "@/lib/server/read-all";

/** Le squadre di una lega, tutte: a pagine, perché oltre mille il database taglia in silenzio. */
export async function leagueTeamIds(admin: SupabaseClient, leagueId: string) {
  const { data, error } = await readAllRows((from, to) => admin
    .from("private_league_members")
    .select("fantasy_team_id")
    .eq("private_league_id", leagueId)
    .order("fantasy_team_id")
    .range(from, to));
  if (error) throw new Error(error.message);
  return data.map((row) => row.fantasy_team_id as string);
}
