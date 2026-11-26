import { checkAdminPage } from "@/components/admin/AdminGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { ImportVoti } from "@/components/admin/ImportVoti";
import { SetupNotice } from "@/components/SetupNotice";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function ImportVotiPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Voti</h1>
        <p className="lede">
          Un file parziale aggiorna solo i calciatori già a voto e rilancia il punteggio provvisorio.
          A giornata final il caricamento si ferma.
        </p>
      </header>
      <AdminNav />
      <ImportVoti />
    </section>
  );
}
