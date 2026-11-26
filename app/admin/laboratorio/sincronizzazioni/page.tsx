import { AdminNav } from "@/components/admin/AdminNav";
import { SyncDesk } from "@/components/admin/SyncDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { readSyncLogs, readSystemSettings } from "@/lib/server/system-settings";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { publicError } from "@/lib/server/api-error";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import Link from "next/link";

export default async function SyncSettingsPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Sincronizzazioni</h1>
        </header>
        <AdminNav />
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }

  try {
    await requireSuperAdmin();
    const [settings, logs] = await Promise.all([readSystemSettings(), readSyncLogs(20)]);
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Sincronizzazioni</h1>
          <p className="lede">Fonti, letture dei voti e storico dei giri automatici. Vale per tutta la piattaforma.</p>
        </header>
        <AdminNav />
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
