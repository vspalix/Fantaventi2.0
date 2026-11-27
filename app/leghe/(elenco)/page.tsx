import { LeagueManager } from "@/components/leagues/LeagueManager";
import { LeaguesHeader } from "@/components/leagues/LeaguesHeader";
import { SetupNotice } from "@/components/SetupNotice";
import { getSessionUser } from "@/lib/server/session";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";

export default async function LeaguesPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  return (
    <section className="stack">
      <LeaguesHeader />
      <LeagueManager signedIn={Boolean(user)} />
    </section>
  );
}
