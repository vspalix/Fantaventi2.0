import { AdminNav } from "@/components/admin/AdminNav";
import { ChaosDesk } from "@/components/admin/ChaosDesk";
import { MaintenanceSwitch } from "@/components/admin/MaintenanceSwitch";
import { TestLab } from "@/components/admin/TestLab";
import { SetupNotice } from "@/components/SetupNotice";
import { loadTestLab } from "@/lib/server/test-lab";
import { errorMessage, getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import Link from "next/link";

export default async function LabPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Collaudo</h1>
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
          <h1 className="section-title">Collaudo</h1>
          <p className="lede">
            Strumenti di stagione: calendario, squadre di test, caos e motore. La giornata vera si gestisce da Admin.
          </p>
        </header>
        <AdminNav />
        <MaintenanceSwitch />
        <ChaosDesk />
        <TestLab initial={lab} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Collaudo</h1>
        </header>
        <p className="banner">{errorMessage(error)}</p>
      </section>
    );
  }
}
