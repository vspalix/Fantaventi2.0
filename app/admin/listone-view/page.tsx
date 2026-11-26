import { checkAdminPage } from "@/components/admin/AdminGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { ListoneView } from "@/components/admin/ListoneView";
import { SetupNotice } from "@/components/SetupNotice";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function ListoneViewPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Listone caricato</h1>
        <p className="lede">
          Calciatori presenti in database per la stagione scelta. Attivo è una registrazione aperta,
          ceduto è una registrazione chiusa.
        </p>
      </header>
      <AdminNav />
      <ListoneView />
    </section>
  );
}
