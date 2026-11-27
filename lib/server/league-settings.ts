import type { SupabaseClient } from "@supabase/supabase-js";
import { applyLeagueRules, parseLeagueRules, type LeagueRules } from "@/lib/league-rules";
import type { RulesetDefinition } from "@/lib/engine/calculator";

export async function readLeagueSettings(admin: SupabaseClient, leagueId: string) {
  const extended = await admin
    .from("private_leagues")
    .select("settings, competition_format, start_matchday, end_matchday")
    .eq("id", leagueId)
    .maybeSingle();
  const plain = extended.error && /competition_format|start_matchday|end_matchday|schema cache|could not find/i.test(extended.error.message)
    ? await admin.from("private_leagues").select("settings").eq("id", leagueId).maybeSingle()
    : extended;
  if (plain.error) {
    if (/settings/i.test(plain.error.message)) return { rules: parseLeagueRules(null), ready: false, range: { from: 1, to: 38 } };
    throw new Error(plain.error.message);
  }
  const row = plain.data as { settings?: unknown; competition_format?: unknown; start_matchday?: unknown; end_matchday?: unknown } | null;
  const range = { from: Number(row?.start_matchday ?? 1) || 1, to: Number(row?.end_matchday ?? 38) || 38 };
  return { rules: parseLeagueRules(row?.settings, row?.competition_format), ready: true, range };
}

export async function definitionForLeague(
  admin: SupabaseClient,
  leagueId: string,
  seasonDefinition: RulesetDefinition,
) {
  const { rules } = await readLeagueSettings(admin, leagueId);
  return { rules, definition: applyLeagueRules(seasonDefinition, rules) };
}
