import { cookies } from "next/headers";
import { RosterBuilder } from "@/components/roster/RosterBuilder";
import { SetupNotice } from "@/components/SetupNotice";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { loadCatalog } from "@/lib/server/catalog";
import { loadLeagueRosters } from "@/lib/server/league-hub";
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
    const [catalog, roster] = await Promise.all([loadCatalog(), meter("roster", () => loadRoster(user.id))]);
    const checkpointNote = await describeCheckpoint(user.id).catch(() => null);
    let others: Awaited<ReturnType<typeof loadLeagueRosters>> | null = null;
    try {
      const leagues = await listLeaguesForUser(user.id);
      const saved = (await cookies()).get(LEAGUE_FOCUS_COOKIE)?.value;
      const league = leagues.find((item) => item.id === saved) ?? leagues[0];
      if (league) others = await loadLeagueRosters(user.id, league.id, roster.appliesFrom, catalog.players);
    } catch {
      others = null;
    }
    return (
      <section className="roster-screen">
        <RosterBuilder
          signedIn
          catalog={catalog}
          initialRoster={roster}
          loadError={null}
          others={others}
          checkpointNote={checkpointNote}
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
