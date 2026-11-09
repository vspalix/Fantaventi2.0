import { RosterBuilder } from "@/components/roster/RosterBuilder";
import { SetupNotice } from "@/components/SetupNotice";
import { loadCatalog } from "@/lib/server/catalog";
import { loadRoster } from "@/lib/server/roster";
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
    return (
      <section className="roster-screen">
        <header>
          <h1 className="section-title">Rosa per club</h1>
          <p className="lede">
            Apri una squadra e scegli un calciatore: la lista si chiude da sola. Togli sta a destra sulla tessera del club.
            Durante le partite della giornata la rosa resta ferma. Al salvataggio valgono ancora un club ciascuno e i limiti di ruolo.
          </p>
        </header>
        <RosterBuilder signedIn catalog={catalog} initialRoster={roster} loadError={null} />
      </section>
    );
  } catch (error) {
    return (
      <section className="roster-screen">
        <header>
          <h1 className="section-title">Rosa per club</h1>
        </header>
        <RosterBuilder signedIn catalog={null} initialRoster={null} loadError={errorMessage(error)} />
      </section>
    );
  }
}
