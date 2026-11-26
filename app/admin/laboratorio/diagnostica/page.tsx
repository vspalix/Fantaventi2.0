import { checkAdminPage } from "@/components/admin/AdminGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { DiagnosticsDesk } from "@/components/admin/DiagnosticsDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { readOpsDiagnostics } from "@/lib/server/ops-diagnostics";
import { publicError } from "@/lib/server/api-error";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DiagnosticsPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  try {
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
        <p className="banner">{publicError("Admin: Diagnostica", error).message}</p>
        <Link href="/admin/laboratorio/sincronizzazioni">Torna alle sincronizzazioni</Link>
      </section>
    );
  }
}
