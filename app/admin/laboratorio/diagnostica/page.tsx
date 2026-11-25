import { AdminNav } from "@/components/admin/AdminNav";
import { DiagnosticsDesk } from "@/components/admin/DiagnosticsDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { readOpsDiagnostics } from "@/lib/server/ops-diagnostics";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DiagnosticsPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header><h1 className="section-title">Diagnostica</h1></header>
        <AdminNav />
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }
  try {
    await requireSuperAdmin();
    const data = await readOpsDiagnostics();
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Diagnostica</h1>
          <p className="lede">Ultimi giri, anomalie e stato della giornata. È una lettura: non ricalcola e non scrive.</p>
        </header>
        <AdminNav />
        <DiagnosticsDesk data={data} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <header><h1 className="section-title">Diagnostica</h1></header>
        <p className="banner">{errorMessage(error)}</p>
        <Link href="/admin/laboratorio/sincronizzazioni">Torna alle sincronizzazioni</Link>
      </section>
    );
  }
}
