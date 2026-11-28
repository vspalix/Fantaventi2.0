import Link from "next/link";
import { PagedTable } from "@/components/ShowMore";
import { checkAdminPage } from "@/components/admin/AdminGate";
import { ScopeChip } from "@/components/admin/AdminShell";
import { ReadVotesNow } from "@/components/admin/ReadVotesNow";
import { SetupNotice } from "@/components/SetupNotice";
import { publicError } from "@/lib/server/api-error";
import { loadAdminOverview, loadLeagueLineups, resolveAdminLeague, type TeamLineup } from "@/lib/server/admin-area";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

const TIME = new Intl.DateTimeFormat("it-IT", { timeStyle: "short", timeZone: "Europe/Rome" });
const DAY_TIME = new Intl.DateTimeFormat("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

const WEEK_STATUS: Record<string, string> = {
  scheduled: "Programmata",
  open: "Formazioni aperte",
  locked: "In corso",
  scored: "Calcolata",
  final: "Chiusa",
};

const READ_KIND: Record<string, string> = {
  halftime: "Lettura intervallo",
  fulltime: "Lettura fine partita",
  morning: "Lettura del mattino",
  calendar: "Calendario",
  calc: "Calcolo punteggi",
};

const READ_OUTCOME: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  ok: { label: "Riuscita", tone: "ok" },
  not_ready: { label: "Voti non pronti", tone: "warn" },
  pending: { label: "In corso", tone: "warn" },
  alert: { label: "Segnalata", tone: "warn" },
  error: { label: "Non riuscita", tone: "bad" },
};

function when(value: string | null, withDay = false) {
  if (!value) return "—";
  const date = new Date(value);
  return withDay || Date.now() - date.getTime() > 20 * 60 * 60 * 1000 ? DAY_TIME.format(date) : TIME.format(date);
}

function State({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) {
  return <span className={`sa-state sa-${tone}`}><span className="sa-dot" aria-hidden="true" />{children}</span>;
}

export default async function AdminOverviewPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;

  try {
    const { data, selected } = await resolveAdminLeague();
    const [overview, teams] = await Promise.all([
      loadAdminOverview(data.week),
      selected ? loadLeagueLineups(selected.id, data.week?.id ?? null) : Promise.resolve([] as TeamLineup[]),
    ]);
    const realLeagues = data.leagues.filter((league) => !league.sandbox);
    const scope = selected ? [selected] : realLeagues;
    const teamsTotal = scope.reduce((sum, league) => sum + league.teams, 0);
    const missingTotal = scope.reduce((sum, league) => sum + Math.max(0, league.teams - league.filed), 0);
    const leaguesMissing = scope.filter((league) => league.teams > league.filed).length;
    const { matches } = overview;
    const lastRead = overview.reads[0] ?? null;
    const week = data.week;

    return (
      <section className="sa-page">
        <header className="sa-page-head">
          <div>
            <h1 className="sa-title">Panoramica</h1>
            <p className="sa-muted">Stagione {data.seasonCode}{week ? ` · Giornata ${week.number}` : ""} · {selected ? selected.name : "Tutte le leghe"}</p>
          </div>
          <div className="sa-legend">
            <ScopeChip scope="global" /><span className="sa-muted sa-small">uguale per tutte le leghe</span>
            <ScopeChip scope="league" /><span className="sa-muted sa-small">segue la lega scelta</span>
          </div>
        </header>

        <div className="sa-kpis">
          <div className="sa-card sa-kpi-card">
            <div className="sa-row-between"><span className="sa-cap sa-muted">{week ? `Giornata ${week.number}` : "Giornata"}</span><ScopeChip scope="global" /></div>
            <div className="sa-kpi">{week ? WEEK_STATUS[week.status] ?? week.status : "—"}</div>
            {matches.total > 0
              ? <State tone={matches.finished === matches.total ? "ok" : "warn"}>{matches.finished} partite finite su {matches.total}</State>
              : <State tone="muted">Nessuna partita in calendario</State>}
          </div>
          <div className="sa-card sa-kpi-card">
            <div className="sa-row-between"><span className="sa-cap sa-muted">Voti</span><ScopeChip scope="global" /></div>
            <div className="sa-kpi">{overview.votes.count}</div>
            <State tone={overview.votes.count > 0 ? "ok" : "muted"}>{overview.votes.lastAt ? `Ultimo carico ${when(overview.votes.lastAt)}` : "Nessun voto per ora"}</State>
          </div>
          <div className="sa-card sa-kpi-card">
            <div className="sa-row-between"><span className="sa-cap sa-muted">Formazioni</span><ScopeChip scope="league" /></div>
            <div className="sa-kpi">{missingTotal}<span className="sa-kpi-unit"> mancanti</span></div>
            {teamsTotal === 0
              ? <State tone="muted">Nessuna squadra</State>
              : missingTotal === 0
                ? <State tone="ok">Tutte consegnate</State>
                : <State tone="bad">{selected ? `su ${teamsTotal} squadre` : `In ${leaguesMissing} ${leaguesMissing === 1 ? "lega" : "leghe"} su ${scope.length}`}</State>}
          </div>
          <div className="sa-card sa-kpi-card">
            <div className="sa-row-between"><span className="sa-cap sa-muted">Letture voti</span><ScopeChip scope="global" /></div>
            <div className="sa-kpi">{lastRead ? when(lastRead.startedAt) : "—"}</div>
            {lastRead
              ? <State tone={READ_OUTCOME[lastRead.outcome]?.tone ?? "warn"}>{READ_KIND[lastRead.kind] ?? lastRead.kind}: {READ_OUTCOME[lastRead.outcome]?.label ?? lastRead.outcome}</State>
              : <State tone="muted">Nessuna lettura registrata</State>}
          </div>
        </div>

        <section className="sa-card" aria-label="Azioni rapide">
          <div className="sa-row-between"><h2 className="sa-cap">Azioni rapide</h2><span className="sa-muted sa-small sa-hide-phone">Le azioni chiedono conferma e restano nel registro</span></div>
          <div className="sa-actions">
            <ReadVotesNow />
            <Link className="sa-btn sa-btn-dark" href="/admin/giornata">Punteggi e rinvii</Link>
            <Link className="sa-btn sa-btn-dark" href="/admin/import-voti">Carica voti da file</Link>
            <Link className="sa-btn sa-btn-dark" href="/admin/formazioni">Formazioni mancanti</Link>
            <Link className="sa-btn sa-btn-dark" href="/admin/notifiche">Invia una notifica</Link>
            <Link className="sa-btn sa-btn-danger" href="/admin/laboratorio">Manutenzione</Link>
          </div>
        </section>

        <div className="sa-grid">
          <section className="sa-card" aria-label="Stato della giornata">
            <div className="sa-row-between"><h2 className="sa-cap">Stato della giornata</h2><ScopeChip scope="global" /></div>
            {matches.total > 0 ? (
              <div className="sa-progress">
                <div className="sa-row-between sa-small"><span className="sa-muted">Partite finite</span><span>{matches.finished} su {matches.total}</span></div>
                <div className="sa-bar"><span style={{ width: `${Math.round((matches.finished / matches.total) * 100)}%` }} /></div>
              </div>
            ) : null}
            <ul className="sa-list">
              <li><span className="sa-grow">Scadenza formazioni</span><span className="sa-muted">{week ? when(week.deadline_at, true) : "—"}</span>{data.locked ? <State tone="ok">Chiuse</State> : <State tone="warn">Aperte</State>}</li>
              <li><span className="sa-grow">Partite in corso</span>{matches.live > 0 ? <State tone="warn">{matches.live}</State> : <span className="sa-muted">Nessuna</span>}</li>
              <li><span className="sa-grow">Prossima partita</span><span className="sa-muted">{matches.nextKickoffAt ? when(matches.nextKickoffAt, true) : "—"}</span></li>
              <li><span className="sa-grow">Rinviate o sospese</span>{matches.held > 0 ? <State tone="bad">{matches.held}</State> : <State tone="ok">Nessuna</State>}</li>
            </ul>
            <Link href="/admin/giornata">Apri la giornata in corso</Link>
          </section>

          <section className="sa-card" aria-label="Letture dei voti">
            <div className="sa-row-between"><h2 className="sa-cap">Letture dei voti</h2><ScopeChip scope="global" /></div>
            {overview.reads.length === 0 ? <p className="sa-muted">Nessuna lettura registrata.</p> : (
              <ul className="sa-list">
                {overview.reads.map((read) => {
                  const outcome = READ_OUTCOME[read.outcome] ?? { label: read.outcome, tone: "warn" as const };
                  return (
                    <li key={`${read.kind}-${read.startedAt}`}>
                      <span className="sa-time">{when(read.startedAt)}</span>
                      <span className="sa-grow">{READ_KIND[read.kind] ?? read.kind}</span>
                      <State tone={outcome.tone}>{outcome.label}</State>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link href="/admin/laboratorio/sincronizzazioni">Letture e sveglie</Link>
          </section>

          <section className="sa-card" aria-label="Formazioni mancanti">
            <div className="sa-row-between"><h2 className="sa-cap">Formazioni mancanti</h2><ScopeChip scope="league" /></div>
            {selected ? (
              teams.length === 0 ? <p className="sa-muted">Nessuna squadra in questa lega.</p> : (
                <ul className="sa-list">
                  {teams.filter((team) => !team.filed).slice(0, 6).map((team) => (
                    <li key={team.id}><span className="sa-grow">{team.name}</span><State tone="bad">Manca</State></li>
                  ))}
                  {teams.every((team) => team.filed) ? <li><span className="sa-grow">Tutte le {teams.length} squadre</span><State tone="ok">Consegnate</State></li> : null}
                </ul>
              )
            ) : data.leagues.length === 0 ? <p className="sa-muted">Nessuna lega in questa stagione.</p> : (
              <PagedTable
                page={10}
                wrapClassName="sa-table-wrap"
                className="sa-table"
                head={<thead><tr><th scope="col">Lega</th><th scope="col" className="sa-num">Consegnate</th><th scope="col" className="sa-num">Mancano</th></tr></thead>}
                rows={data.leagues.map((league) => {
                  const missing = Math.max(0, league.teams - league.filed);
                  return (
                    <tr key={league.id}>
                      <td>{league.name}{league.sandbox ? <span className="sa-muted sa-small"> · di prova</span> : null}</td>
                      <td className="sa-num">{league.filed} / {league.teams}</td>
                      <td className={`sa-num ${missing > 0 ? "sa-bad" : "sa-ok"}`}>{missing}</td>
                    </tr>
                  );
                })}
              />
            )}
            <Link href="/admin/formazioni">{selected ? "Tutte le squadre della lega" : "Vedi chi manca"}</Link>
          </section>

          <section className="sa-card" aria-label="Errori recenti">
            <div className="sa-row-between"><h2 className="sa-cap">Errori recenti</h2><span className="sa-chip sa-chip-new">Da attivare</span></div>
            <p className="sa-muted">Oggi gli errori arrivano solo su Telegram. Per elencarli qui serve una tabella nuova nel database: si attiva dopo la tua conferma.</p>
          </section>

          <section className="sa-card" aria-label="Utenti e leghe">
            <div className="sa-row-between"><h2 className="sa-cap">Utenti e leghe</h2><ScopeChip scope="global" /></div>
            <div className="sa-mini-kpis">
              <div><div className="sa-kpi sa-kpi-sm">{overview.people.users}</div><div className="sa-muted sa-small">utenti</div></div>
              <div><div className="sa-kpi sa-kpi-sm">+{overview.people.newThisWeek}</div><div className="sa-muted sa-small">iscritti in 7 giorni</div></div>
              <div><div className="sa-kpi sa-kpi-sm">{realLeagues.length}</div><div className="sa-muted sa-small">leghe{data.leagues.length > realLeagues.length ? `, più ${data.leagues.length - realLeagues.length} di prova` : ""}</div></div>
            </div>
            <ul className="sa-list">
              <li><span className="sa-grow">Entrati negli ultimi 7 giorni</span><span>{overview.people.activeThisWeek ?? "—"}</span></li>
              <li><span className="sa-grow">Dispositivi con notifiche attive</span><span>{overview.people.pushDevices}</span></li>
            </ul>
            <Link href="/admin/utenti">Apri utenti</Link>
          </section>

          <section className="sa-card" aria-label="Ultime azioni admin">
            <div className="sa-row-between"><h2 className="sa-cap">Ultime azioni admin</h2><ScopeChip scope="global" /></div>
            {overview.audit.length === 0 ? <p className="sa-muted">Nessuna azione registrata.</p> : (
              <ul className="sa-list">
                {overview.audit.map((row) => (
                  <li key={row.id}><span className="sa-time">{when(row.createdAt)}</span><span className="sa-grow">{row.label}</span></li>
                ))}
              </ul>
            )}
            <Link href="/admin/registro">Apri il registro</Link>
          </section>
        </div>
      </section>
    );
  } catch (error) {
    return (
      <section className="sa-page">
        <h1 className="sa-title">Panoramica</h1>
        <p className="banner">{publicError("Admin: Panoramica", error).message}</p>
      </section>
    );
  }
}
