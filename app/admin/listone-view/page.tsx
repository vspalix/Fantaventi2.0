import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { ListoneView } from "@/components/admin/ListoneView";
import { SetupNotice } from "@/components/SetupNotice";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function ListoneViewPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Listone caricato</h1>
          <p className="lede">Entra per controllare i calciatori salvati.</p>
        </header>
        <AdminNav />
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }

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
