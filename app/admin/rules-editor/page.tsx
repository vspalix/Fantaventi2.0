import { AdminNav } from "@/components/admin/AdminNav";
import { RegulationEditor } from "@/components/admin/RegulationEditor";
import { SetupNotice } from "@/components/SetupNotice";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { errorMessage, getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import Link from "next/link";

export default async function RulesEditorPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Gestione regolamento</h1>
          <p className="lede">Entra per modificare il regolamento delle leghe che hai creato.</p>
        </header>
        <AdminNav />
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }

  try {
    const leagues = (await listLeaguesForUser(user.id))
      .filter((league) => league.isOwner)
      .map((league) => ({ id: league.id, name: league.name }));
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Gestione regolamento</h1>
          <p className="lede">Modifica il testo ufficiale e scaricalo in documento.</p>
        </header>
        <AdminNav />
        <RegulationEditor leagues={leagues} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <header><h1 className="section-title">Gestione regolamento</h1></header>
        <p className="banner">{errorMessage(error)}</p>
      </section>
    );
  }
}
