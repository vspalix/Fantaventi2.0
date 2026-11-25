import Link from "next/link";
import { cookies } from "next/headers";
import { RosterBuilder } from "@/components/roster/RosterBuilder";
import { SetupNotice } from "@/components/SetupNotice";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { loadCatalog } from "@/lib/server/catalog";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { describeCheckpoint, loadRoster } from "@/lib/server/roster";
import { errorMessage, getSessionUser } from "@/lib/server/session";
import { meter } from "@/lib/server/telemetry";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function RosterPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) {
    return <SetupNotice />;
  }

  const user = await getSessionUser();
  if (!user) {
    return <RosterBuilder signedIn={false} catalog={null} initialRoster={null} loadError={null} />;
  }

  try {
    const leagues = await listLeaguesForUser(user.id);
    const saved = (await cookies()).get(LEAGUE_FOCUS_COOKIE)?.value;
    const league = leagues.find((item) => item.id === saved) ?? leagues[0] ?? null;
    if (!league) {
      return (
        <section className="card">
          <h2>Ogni lega ha la sua rosa</h2>
          <p>L&apos;account è uno solo. La squadra, la formazione e il ruolo li decidi dentro la lega: admin in una, giocatore in un&apos;altra.</p>
          <Link className="primary" href="/leghe">Vai alle leghe</Link>
        </section>
      );
    }
    const [catalog, roster, checkpointNote] = await Promise.all([
      loadCatalog(),
      meter("roster", () => loadRoster(user.id, league.id)),
      describeCheckpoint(user.id, league.id).catch(() => null),
    ]);
    return (
      <section className="roster-screen">
        <RosterBuilder
          signedIn
          catalog={catalog}
          initialRoster={roster}
          loadError={null}
          others={null}
          checkpointNote={checkpointNote}
          leagueId={league.id}
          leagueName={league.name}
        />
      </section>
    );
  } catch (error) {
    return (
      <section className="roster-screen">
        <RosterBuilder signedIn catalog={null} initialRoster={null} loadError={errorMessage(error)} />
      </section>
    );
  }
}
