import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { ImportListone } from "@/components/admin/ImportListone";
import { SetupNotice } from "@/components/SetupNotice";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function ImportListonePage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Listone</h1>
          <p className="lede">Entra per importare le quotazioni ufficiali.</p>
        </header>
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }

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
