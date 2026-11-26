import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RegulationView } from "@/components/rules/RegulationView";
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
    <section className="stack">
      <header>
        <h1 className="section-title">Regolamento</h1>
        <p className="lede">I numeri di base con cui si calcolano i punteggi. Dentro una lega il testo segue le regole di quella lega e si può scaricare.</p>
      </header>
      <article className="card stack">
        <RegulationView markdown={generalRegulationMarkdown()} />
      </article>
    </section>
  );
}
