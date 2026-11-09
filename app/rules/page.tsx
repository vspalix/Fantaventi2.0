import Link from "next/link";
import { DownloadRegulation, RegulationView } from "@/components/rules/RegulationView";
import { SetupNotice } from "@/components/SetupNotice";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { loadRegulation } from "@/lib/server/regulation";
import { errorMessage, getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ league?: string }> }) {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="card stack">
        <h1 className="section-title">Regolamento ufficiale</h1>
        <p>Entra per leggere il regolamento delle tue leghe.</p>
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }

  try {
    const leagues = await listLeaguesForUser(user.id);
    const query = await searchParams;
    const selected = leagues.find((league) => league.id === query.league) ?? leagues[0] ?? null;
    const document = selected ? await loadRegulation(user.id, selected.id) : null;
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Regolamento ufficiale</h1>
          <p className="lede">Il testo che vale per la classifica di ogni lega a cui partecipi.</p>
        </header>
        {leagues.length === 0 || !document || !selected ? (
          <article className="card">
            <h2>Nessuna lega</h2>
            <p>Entra in una lega per leggerne il regolamento.</p>
            <Link className="primary" href="/leghe">Vai alle leghe</Link>
          </article>
        ) : (
          <article className="card stack">
            <div className="tabs" aria-label="Leghe">
              {leagues.map((league) => (
                <Link key={league.id} className="tab" href={`/rules?league=${league.id}`} data-active={league.id === selected.id}>
                  {league.name}
                </Link>
              ))}
            </div>
            <p className="small muted">
              {document.stored ? "Testo salvato dall'amministratore della lega." : "Testo ufficiale, non ancora personalizzato."}
              {document.canEdit ? " Puoi modificarlo dalla gestione regolamento." : ""}
            </p>
            <DownloadRegulation leagueId={selected.id} />
            <RegulationView markdown={document.markdown} />
          </article>
        )}
      </section>
    );
  } catch (error) {
    return (
      <section className="card">
        <h2>Regolamento non disponibile</h2>
        <p>{errorMessage(error)}</p>
      </section>
    );
  }
}
