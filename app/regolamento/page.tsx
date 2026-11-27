import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RegulationReader } from "@/components/rules/RegulationReader";
import { generalRegulationMarkdown } from "@/config/gameRules";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { reportError } from "@/lib/server/error-report";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function RegolamentoPage() {
  if (hasPublicSupabaseEnv() && hasServiceSupabaseEnv()) {
    const user = await getSessionUser();
    if (user) {
      const leagues = await listLeaguesForUser(user.id).catch((error: unknown) => {
        void reportError("Schermata Regolamento: elenco leghe", error);
        return [];
      });
      const saved = (await cookies()).get(LEAGUE_FOCUS_COOKIE)?.value;
      const league = leagues.find((item) => item.id === saved) ?? leagues[0];
      if (league) redirect(`/leghe/${league.id}?tab=regolamento`);
    }
  }

  return (
    <section className="rg-page">
      <header className="lineup-head">
        <h1 className="section-title">Regolamento</h1>
        <p className="small muted">Le regole di base. Dentro una lega valgono quelle della lega.</p>
      </header>
      <RegulationReader markdown={generalRegulationMarkdown()} />
    </section>
  );
}
