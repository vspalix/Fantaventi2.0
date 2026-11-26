import { AdminNav } from "@/components/admin/AdminNav";
import { LiveSyncDesk } from "@/components/admin/LiveSyncDesk";
import { MatchdayDesk } from "@/components/admin/MatchdayDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { loadTestLab } from "@/lib/server/test-lab";
import { publicError } from "@/lib/server/api-error";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AdminPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Admin</h1>
          <p className="lede">Entra per gestire voti, classifica, rinvii e formazioni.</p>
        </header>
        <AdminNav />
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }

  try {
    const lab = await loadTestLab(user.id);
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Admin</h1>
          <p className="lede">
            Stagione {lab.seasonCode}. Stato del sync live, voti della giornata, ricalcolo della classifica, rinvii e formazioni consegnate.
          </p>
        </header>
        <AdminNav />
        <LiveSyncDesk />
        <MatchdayDesk initial={lab} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Admin</h1>
        </header>
        <p className="banner">{publicError("Admin", error).message}</p>
      </section>
    );
  }
}
