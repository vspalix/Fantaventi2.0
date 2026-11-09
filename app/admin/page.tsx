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

export default async function AdminPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Admin di test</h1>
          <p className="lede">Entra con il tuo account per impostare la giornata, schierare, calcolare e passare alla successiva.</p>
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
          <h1 className="section-title">Admin di test</h1>
          <p className="lede">
            Stagione {lab.seasonCode}. Importa il calendario, chiudi le partite e calcola.
            Puoi annullare un calcolo e ricaricare i voti: finché non ricalcoli, quella giornata non porta punti.
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
          <h1 className="section-title">Admin di test</h1>
        </header>
        <p className="banner">{errorMessage(error)}</p>
      </section>
    );
  }
}
