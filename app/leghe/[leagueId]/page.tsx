import Link from "next/link";
import { LeagueHub } from "@/components/leagues/LeagueHub";
import { SetupNotice } from "@/components/SetupNotice";
import { loadLeagueHub } from "@/lib/server/league-hub";
import { errorMessage, getSessionUser } from "@/lib/server/session";
import { readViewMode } from "@/lib/server/view-mode";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function LeaguePage({ params }: { params: Promise<{ leagueId: string }> }) {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="card">
        <h2>Entra per vedere la lega</h2>
        <Link className="primary" href="/accesso">Vai all&apos;accesso</Link>
      </section>
    );
  }

  const { leagueId } = await params;
  try {
    const hub = await loadLeagueHub(user.id, leagueId);
    const hostMode = await readViewMode() === "host";
    return (
      <LeagueHub
        initial={hub}
        hostMode={hostMode && (hub.league.isManager || hub.league.platformOverride)}
        allowTestFill={hostMode && process.env.NODE_ENV === "development" && hub.league.isOwner}
      />
    );
  } catch (error) {
    return (
      <section className="card">
        <h2>Lega non disponibile</h2>
        <p>{errorMessage(error)}</p>
        <Link href="/leghe">Torna alle leghe</Link>
      </section>
    );
  }
}
