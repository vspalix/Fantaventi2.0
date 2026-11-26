import { checkAdminPage } from "@/components/admin/AdminGate";
import { RegulationEditor } from "@/components/admin/RegulationEditor";
import { SetupNotice } from "@/components/SetupNotice";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { readAdminLeagueId } from "@/lib/server/admin-area";
import { publicError } from "@/lib/server/api-error";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function RulesEditorPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  try {
    const leagues = (await listLeaguesForUser(gate.user.id))
      .filter((league) => league.isOwner)
      .map((league) => ({ id: league.id, name: league.name }));
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Gestione regolamento</h1>
          <p className="lede">Modifica il testo ufficiale e scaricalo in documento.</p>
        </header>
        <RegulationEditor leagues={leagues} initialLeagueId={await readAdminLeagueId()} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <header><h1 className="section-title">Gestione regolamento</h1></header>
        <p className="banner">{publicError("Admin: Regolamento", error).message}</p>
      </section>
    );
  }
}
