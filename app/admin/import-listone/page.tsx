import { checkAdminPage } from "@/components/admin/AdminGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { ImportListone } from "@/components/admin/ImportListone";
import { SetupNotice } from "@/components/SetupNotice";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function ImportListonePage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Listone</h1>
        <p className="lede">
          Carica il file quotazioni della competizione. I calciatori attivi aggiornano il listone,
          i ceduti chiudono solo la registrazione corrente.
        </p>
      </header>
      <AdminNav />
      <ImportListone />
    </section>
  );
}
