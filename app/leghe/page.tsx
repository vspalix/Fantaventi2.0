import { LeagueManager } from "@/components/leagues/LeagueManager";
import { SetupNotice } from "@/components/SetupNotice";
import { getSessionUser } from "@/lib/server/session";
import { hostAccess } from "@/lib/server/view-mode";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";

export default async function LeaguesPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  const hostMode = user ? (await hostAccess(user.id)).hostMode : false;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Leghe</h1>
        <p className="lede">Una lega riunisce le squadre della stagione. Il codice non scade da solo.</p>
      </header>
      <LeagueManager signedIn={Boolean(user)} hostMode={hostMode} />
    </section>
  );
}
