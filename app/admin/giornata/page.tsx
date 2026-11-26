import { checkAdminPage } from "@/components/admin/AdminGate";
import { LiveSyncDesk } from "@/components/admin/LiveSyncDesk";
import { MatchdayDesk } from "@/components/admin/MatchdayDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { loadTestLab } from "@/lib/server/test-lab";
import { publicError } from "@/lib/server/api-error";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function AdminPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  try {
    const lab = await loadTestLab(gate.user.id);
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Giornata in corso</h1>
          <p className="lede">
            Stagione {lab.seasonCode}. Stato del sync live, voti della giornata, ricalcolo della classifica, rinvii e formazioni consegnate.
          </p>
        </header>
        <LiveSyncDesk />
        <MatchdayDesk initial={lab} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Giornata in corso</h1>
        </header>
        <p className="banner">{publicError("Admin", error).message}</p>
      </section>
    );
  }
}
