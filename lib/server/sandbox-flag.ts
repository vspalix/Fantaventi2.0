export const SANDBOX_LEAGUE_NAME = "SANDBOX_STRESS_TEST";
export const SANDBOX_SEASON_CODE = "sandbox";
export const SANDBOX_SQL = "Esegui sandbox_league.sql nell'editor SQL di Supabase prima del laboratorio.";

export function missingSandboxColumn(message: string) {
  return /is_sandbox|schema cache|could not find/i.test(message);
}
