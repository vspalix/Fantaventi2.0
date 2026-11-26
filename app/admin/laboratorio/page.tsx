import { checkAdminPage } from "@/components/admin/AdminGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { SandboxDesk } from "@/components/admin/SandboxDesk";
import { ChaosDesk } from "@/components/admin/ChaosDesk";
import { MaintenanceSwitch } from "@/components/admin/MaintenanceSwitch";
import { TestLab } from "@/components/admin/TestLab";
import { SetupNotice } from "@/components/SetupNotice";
import { loadTestLab } from "@/lib/server/test-lab";
import { publicError } from "@/lib/server/api-error";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import Link from "next/link";

export default async function LabPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  try {
    const lab = await loadTestLab(gate.user.id);
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Collaudo</h1>
          <p className="lede">
            Strumenti di stagione: calendario, squadre di test, caos e motore. La giornata vera si gestisce da Admin.
          </p>
        </header>
        <AdminNav />
        <p><Link href="/admin/laboratorio/indisponibili">Indisponibili e fonte dati</Link></p>
        <p><Link href="/admin/laboratorio/sincronizzazioni">Sincronizzazioni e letture</Link></p>
        <p><Link href="/admin/laboratorio/diagnostica">Diagnostica</Link></p>
        <p><Link href="/admin/laboratorio/brand">Brand & Grafica</Link></p>
        <SandboxDesk />
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
        <p className="banner">{publicError("Admin: Laboratorio", error).message}</p>
      </section>
    );
  }
}
