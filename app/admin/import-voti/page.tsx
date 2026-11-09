import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { ImportVoti } from "@/components/admin/ImportVoti";
import { SetupNotice } from "@/components/SetupNotice";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function ImportVotiPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Voti</h1>
          <p className="lede">Entra per importare i voti di giornata.</p>
        </header>
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }

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
