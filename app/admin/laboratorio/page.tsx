import { checkAdminPage } from "@/components/admin/AdminGate";
import { SandboxDesk } from "@/components/admin/SandboxDesk";
import { ChaosDesk } from "@/components/admin/ChaosDesk";
import { MaintenanceSwitch } from "@/components/admin/MaintenanceSwitch";
import { PushBroadcast } from "@/components/admin/PushBroadcast";
import { TestLab } from "@/components/admin/TestLab";
import { SetupNotice } from "@/components/SetupNotice";
import { loadTestLab } from "@/lib/server/test-lab";
import { publicError } from "@/lib/server/api-error";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

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
        <SandboxDesk />
        <MaintenanceSwitch />
        <PushBroadcast />
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
