import type { SupabaseClient } from "@supabase/supabase-js";
import { applyLeagueRules, parseLeagueRules, type LeagueRules } from "@/lib/league-rules";
import { rulesAt } from "@/lib/scoring-history";
import type { RulesetDefinition } from "@/lib/engine/calculator";
import { readAllChunks } from "@/lib/server/read-all";

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
  return settingsOf(plain.data as SettingsRow | null);
}

type SettingsRow = { id?: string; settings?: unknown; competition_format?: unknown; start_matchday?: unknown; end_matchday?: unknown };

function settingsOf(row: SettingsRow | null) {
  const range = { from: Number(row?.start_matchday ?? 1) || 1, to: Number(row?.end_matchday ?? 38) || 38 };
  return { rules: parseLeagueRules(row?.settings, row?.competition_format), ready: true, range };
}

/** Come `readLeagueSettings`, per tante leghe insieme: una richiesta ogni cento, non una per lega. */
export async function readManyLeagueSettings(admin: SupabaseClient, leagueIds: string[]) {
  const found = new Map<string, Awaited<ReturnType<typeof readLeagueSettings>>>();
  const { data, error } = await readAllChunks(leagueIds, (ids, from, to) => admin
    .from("private_leagues")
    .select("id, settings, competition_format, start_matchday, end_matchday")
    .in("id", ids)
    .order("id")
    .range(from, to));
  if (error) {
    // Database senza le colonne nuove: si torna alla lettura una per una, che le gestisce.
    if (!/competition_format|start_matchday|end_matchday|settings|schema cache|could not find/i.test(error.message)) throw new Error(error.message);
    for (const leagueId of leagueIds) found.set(leagueId, await readLeagueSettings(admin, leagueId));
    return found;
  }
  const rows = new Map((data as SettingsRow[]).map((row) => [row.id as string, row]));
  for (const leagueId of leagueIds) found.set(leagueId, settingsOf(rows.get(leagueId) ?? null));
  return found;
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
