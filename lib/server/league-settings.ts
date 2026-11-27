import type { SupabaseClient } from "@supabase/supabase-js";
import { applyLeagueRules, parseLeagueRules, type LeagueRules } from "@/lib/league-rules";
import { rulesAt } from "@/lib/scoring-history";
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

/**
 * Le regole di calcolo di una lega, giornata per giornata: un bonus cambiato «da ora»
 * lascia le giornate precedenti con il valore che avevano.
 */
export async function leagueDefinitions(
  admin: SupabaseClient,
  leagueId: string,
  seasonDefinition: RulesetDefinition,
) {
  const { rules } = await readLeagueSettings(admin, leagueId);
  const at = (matchday: number | null) => applyLeagueRules(seasonDefinition, matchday === null ? rules : rulesAt(rules, matchday));
  return { rules, at };
}

/** `matchday` è la giornata da calcolare; `null` solo per i laboratori, che usano le regole di oggi. */
export async function definitionForLeague(
  admin: SupabaseClient,
  leagueId: string,
  seasonDefinition: RulesetDefinition,
  matchday: number | null,
) {
  const { rules, at } = await leagueDefinitions(admin, leagueId, seasonDefinition);
  return { rules, definition: at(matchday) };
}
