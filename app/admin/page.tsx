import { checkAdminPage } from "@/components/admin/AdminGate";
import { DashboardView } from "@/components/admin/DashboardView";
import { SetupNotice } from "@/components/SetupNotice";
import { publicError } from "@/lib/server/api-error";
import { loadDashboard } from "@/lib/server/admin-dashboard";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function AdminDashboardPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  try {
    const data = await loadDashboard();
    return (
      <section className="sa-page db-page">
        <header className="sa-page-head">
          <h1 className="sa-title">Dashboard</h1>
          <p className="sa-muted">Stagione {data.seasonCode}</p>
        </header>
        <DashboardView data={data} />
      </section>
    );
  } catch (error) {
    return (
      <section className="sa-page">
        <h1 className="sa-title">Dashboard</h1>
        <p className="banner">{publicError("Admin: Dashboard", error).message}</p>
      </section>
    );
  }
}
