import { LeagueManager } from "@/components/leagues/LeagueManager";
import { LeaguesHeader } from "@/components/leagues/LeaguesHeader";
import { SetupNotice } from "@/components/SetupNotice";
import { getSessionUser } from "@/lib/server/session";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";

export default async function LeaguesPage({ searchParams }: { searchParams: Promise<{ nuova?: string }> }) {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  // «Crea una Lega» dalla Home arriva qui con il modulo di creazione già aperto.
  const { nuova } = await searchParams;
  return (
    <section className="stack">
      <LeaguesHeader />
      <LeagueManager signedIn={Boolean(user)} startCreating={nuova === "1"} />
    </section>
  );
}
