import { checkAdminPage } from "@/components/admin/AdminGate";
import { SetupNotice } from "@/components/SetupNotice";
import { PagedList, PagedTable } from "@/components/ShowMore";
import { publicError } from "@/lib/server/api-error";
import { loadLeagueLineups, resolveAdminLeague } from "@/lib/server/admin-area";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

const WHEN = new Intl.DateTimeFormat("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

export default async function AdminLineupsPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  try {
    const { data, selected } = await resolveAdminLeague();
    const week = data.week;
    const teams = selected ? await loadLeagueLineups(selected.id, week?.id ?? null) : [];
    const deadline = week ? WHEN.format(new Date(week.deadline_at)) : null;

    return (
      <section className="sa-page">
        <header className="sa-page-head">
          <div>
            <h1 className="sa-title">Formazioni</h1>
            <p className="sa-muted">
              {week ? `Giornata ${week.number} · scadenza ${deadline}${data.locked ? " (chiusa)" : ""}` : "Nessuna giornata in calendario"} · {selected ? selected.name : "Tutte le leghe"}
            </p>
          </div>
        </header>

        {selected ? (
          <section className="sa-card" aria-label={`Squadre di ${selected.name}`}>
            <div className="sa-row-between">
              <h2 className="sa-cap">{selected.name}</h2>
              <span className="sa-muted sa-small">{selected.filed} consegnate su {selected.teams}</span>
            </div>
            {teams.length === 0 ? <p className="sa-muted">Nessuna squadra in questa lega.</p> : (
              <PagedList className="sa-list" rows={teams.map((team) => (
                <li key={team.id}>
                  <span className="sa-grow">{team.name}</span>
                  {team.filed
                    ? <span className="sa-state sa-ok"><span className="sa-dot" aria-hidden="true" />Consegnata{team.savedAt ? ` ${WHEN.format(new Date(team.savedAt))}` : ""}</span>
                    : <span className="sa-state sa-bad"><span className="sa-dot" aria-hidden="true" />Manca</span>}
                </li>
              ))} />
            )}
            <p className="sa-muted sa-small">Per riaprire le formazioni di una giornata usa «Impostazioni della lega».</p>
          </section>
        ) : (
          <section className="sa-card" aria-label="Riepilogo di tutte le leghe">
            <div className="sa-row-between">
              <h2 className="sa-cap">Tutte le leghe</h2>
              <span className="sa-muted sa-small">Scegli una lega in alto per vedere le squadre</span>
            </div>
            {data.leagues.length === 0 ? <p className="sa-muted">Nessuna lega in questa stagione.</p> : (
              <PagedTable
                wrapClassName="sa-table-wrap"
                className="sa-table"
                head={<thead><tr><th scope="col">Lega</th><th scope="col" className="sa-num">Squadre</th><th scope="col" className="sa-num">Consegnate</th><th scope="col" className="sa-num">Mancano</th></tr></thead>}
                rows={data.leagues.map((league) => {
                  const missing = Math.max(0, league.teams - league.filed);
                  return (
                    <tr key={league.id}>
                      <td>{league.name}{league.sandbox ? <span className="sa-muted sa-small"> · di prova</span> : null}</td>
                      <td className="sa-num">{league.teams}</td>
                      <td className="sa-num">{league.filed}</td>
                      <td className={`sa-num ${missing > 0 ? "sa-bad" : "sa-ok"}`}>{missing}</td>
                    </tr>
                  );
                })}
              />
            )}
          </section>
        )}
      </section>
    );
  } catch (error) {
    return (
      <section className="sa-page">
        <h1 className="sa-title">Formazioni</h1>
        <p className="banner">{publicError("Admin: Formazioni", error).message}</p>
      </section>
    );
  }
}
