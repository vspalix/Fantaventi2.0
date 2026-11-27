import Link from "next/link";
import { LeagueHub } from "@/components/leagues/LeagueHub";
import { isHubTab } from "@/lib/hub-tabs";
import { SetupNotice } from "@/components/SetupNotice";
import { loadLeagueHub } from "@/lib/server/league-hub";
import { publicError } from "@/lib/server/api-error";
import { getSessionUser } from "@/lib/server/session";
import { hostAccess } from "@/lib/server/view-mode";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function LeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ tab?: string; giornata?: string; formazione?: string }>;
}) {
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
  const query = await searchParams;
  const requested = query.tab;
  const round = Number.parseInt(query.giornata ?? "", 10);
  try {
    const [hub, { hostMode }] = await Promise.all([loadLeagueHub(user.id, leagueId), hostAccess(user.id)]);
    return (
      <LeagueHub
        initial={hub}
        initialTab={isHubTab(requested) ? requested : "home"}
        initialRound={Number.isInteger(round) && round > 0 ? round : undefined}
        initialOpenMine={query.formazione === "mia"}
        hostMode={hostMode && (hub.league.isManager || hub.league.platformOverride)}
        allowTestFill={hostMode && process.env.NODE_ENV === "development" && hub.league.isOwner}
      />
    );
  } catch (error) {
    return (
      <section className="card">
        <h2>Lega non disponibile</h2>
        <p>{publicError("Schermata Lega", error).message}</p>
        <Link href="/leghe">Torna alle leghe</Link>
      </section>
    );
  }
}
