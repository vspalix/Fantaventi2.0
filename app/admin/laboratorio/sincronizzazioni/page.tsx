import { checkAdminPage } from "@/components/admin/AdminGate";
import { SyncDesk } from "@/components/admin/SyncDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { readSyncLogs, readSystemSettings } from "@/lib/server/system-settings";
import { publicError } from "@/lib/server/api-error";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function SyncSettingsPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  try {
    const [settings, logs] = await Promise.all([readSystemSettings(), readSyncLogs(20)]);
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Sincronizzazioni</h1>
          <p className="lede">Fonti, letture dei voti e storico dei giri automatici. Vale per tutta la piattaforma.</p>
        </header>
        <SyncDesk initial={settings} initialLogs={logs} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Sincronizzazioni</h1>
        </header>
        <p className="banner">{publicError("Admin: Sincronizzazioni", error).message}</p>
      </section>
    );
  }
}
