import Link from "next/link";
import { dashboardWhen, PLAYING_DAYS } from "@/lib/admin-dashboard";
import type { DashboardData } from "@/lib/server/admin-dashboard";

const LEAGUES_SHOWN = 5;

const WEEK_STATUS: Record<string, string> = {
  scheduled: "Programmata",
  open: "Formazioni aperte",
  locked: "In corso",
  scored: "Calcolata",
  final: "Chiusa",
};

const READ_OUTCOME: Record<string, string> = {
  ok: "riuscita",
  not_ready: "voti non ancora pronti",
  pending: "in corso",
  error: "non riuscita",
};

function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  const share = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="db-meter">
      <div className="sa-row-between">
        <span>{label}</span>
        <b>{value}<span className="sa-muted"> / {total}</span></b>
      </div>
      <div className="sa-bar"><span style={{ width: `${share}%` }} /></div>
    </div>
  );
}

function Status({ problems }: { problems: DashboardData["problems"] }) {
  if (problems.length === 0) {
    return (
      <section className="sa-card db-calm" aria-label="Stato dell'app">
        <span className="db-check" aria-hidden="true">✓</span>
        <div>
          <strong>Tutto a posto</strong>
          <p className="sa-muted">Nessun problema da controllare.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="sa-card db-alerts" aria-label="Stato dell'app">
      <h2 className="sa-cap">Da controllare · {problems.length}</h2>
      <ul>
        {problems.map((problem) => (
          <li key={problem.id}>
            <Link href={problem.href} data-tone={problem.tone}>
              <span className="sa-dot" aria-hidden="true" />
              <span className="sa-grow">
                <strong>{problem.title}</strong>
                <small>{problem.detail}</small>
              </span>
              <span className="sa-chevron" aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function People({ people }: { people: DashboardData["people"] }) {
  if (!people) {
    return (
      <section className="sa-card" aria-label="Persone">
        <h2 className="sa-cap">Persone</h2>
        <p className="sa-muted">Dati non disponibili in questo momento.</p>
      </section>
    );
  }
  const top = Math.max(1, ...people.weekly);
  return (
    <section className="sa-card" aria-label="Persone">
      <h2 className="sa-cap">Persone</h2>
      <div className="db-hero">
        <b>{people.users}</b>
        <span>
          {people.users === 1 ? "persona iscritta" : "persone iscritte"}
          <small className={people.newThisWeek > 0 ? "sa-ok" : "sa-muted"}>
            {people.newThisWeek > 0 ? `+${people.newThisWeek} in 7 giorni` : "Nessuna nuova in 7 giorni"}
          </small>
        </span>
      </div>
      <figure className="db-chart">
        <ol>
          {people.weekly.map((count, index) => {
            const weeksAgo = people.weekly.length - 1 - index;
            const name = weeksAgo === 0 ? "Ultimi 7 giorni" : `${weeksAgo} ${weeksAgo === 1 ? "settimana" : "settimane"} fa`;
            return (
              <li key={weeksAgo} data-now={weeksAgo === 0} aria-label={`${name}: ${count}`} title={`${name}: ${count}`}>
                <small aria-hidden="true">{count > 0 ? count : ""}</small>
                <span style={{ height: `${Math.round((count / top) * 56) + 3}px` }} />
              </li>
            );
          })}
        </ol>
        <figcaption><span>{people.weekly.length} settimane fa</span><span>Nuovi iscritti</span><span>Oggi</span></figcaption>
      </figure>
      <Meter label={`Hanno schierato negli ultimi ${PLAYING_DAYS} giorni`} value={people.playing} total={people.users} />
      <Meter label="Con le notifiche attive" value={people.withPush} total={people.users} />
      <ul className="sa-list">
        <li><span className="sa-grow">Senza una lega</span><b>{people.withoutLeague}</b></li>
      </ul>
      {people.testUsers > 0 ? <p className="sa-muted sa-small">Esclusi {people.testUsers} account di prova.</p> : null}
      <Link href="/admin/utenti" className="db-more">Tutti gli utenti</Link>
    </section>
  );
}

function Matchday({ week }: { week: DashboardData["week"] }) {
  if (!week) {
    return (
      <section className="sa-card" aria-label="Giornata">
        <h2 className="sa-cap">Giornata</h2>
        <p className="sa-muted">Nessuna giornata in calendario.</p>
      </section>
    );
  }
  const status = week.status === "open" && week.locked ? "In corso" : WEEK_STATUS[week.status] ?? week.status;
  return (
    <section className="sa-card" aria-label={`Giornata ${week.number}`}>
      <div className="sa-row-between">
        <h2 className="sa-cap">Giornata {week.number}</h2>
        <span className="sa-chip sa-chip-league">{status}</span>
      </div>
      <p className="db-deadline">
        <small className="sa-muted">{week.locked ? "Formazioni chiuse" : "Le formazioni chiudono"}</small>
        <strong>{dashboardWhen(week.deadlineAt)}</strong>
      </p>
      <Meter label="Formazioni consegnate" value={week.lineups.filed} total={week.lineups.teams} />
      <Meter label="Partite giocate" value={week.matches.played} total={week.matches.total} />
      <ul className="sa-list">
        {week.matches.live > 0 ? <li><span className="sa-grow">Partite in corso</span><b>{week.matches.live}</b></li> : null}
        <li>
          <span className="sa-grow">Ultima lettura voti</span>
          <span className="sa-muted">
            {week.lastVoteRead ? `${dashboardWhen(week.lastVoteRead.at)} · ${READ_OUTCOME[week.lastVoteRead.outcome] ?? week.lastVoteRead.outcome}` : "Non ancora"}
          </span>
        </li>
      </ul>
      <Link href="/admin/giornata" className="db-more">Apri la giornata</Link>
    </section>
  );
}

function Leagues({ leagues, week }: { leagues: DashboardData["leagues"]; week: DashboardData["week"] }) {
  const missing = (league: DashboardData["leagues"]["rows"][number]) => league.teams - league.filed;
  const shown = [...leagues.rows]
    .sort((left, right) => missing(right) - missing(left) || right.teams - left.teams || left.name.localeCompare(right.name, "it"))
    .slice(0, LEAGUES_SHOWN);
  const hidden = leagues.rows.length - shown.length;
  return (
    <section className="sa-card" aria-label="Leghe">
      <h2 className="sa-cap">Leghe</h2>
      <div className="db-hero">
        <b>{leagues.rows.length}</b>
        <span>
          {leagues.rows.length === 1 ? "lega" : "leghe"}
          <small className="sa-muted">{leagues.teams} {leagues.teams === 1 ? "squadra" : "squadre"}</small>
        </span>
      </div>
      {shown.length > 0 ? (
        <ul className="sa-list">
          {shown.map((league) => (
            <li key={league.id}>
              <span className="sa-grow db-name">{league.name}</span>
              {!week || league.teams === 0
                ? <span className="sa-muted">{league.teams} {league.teams === 1 ? "squadra" : "squadre"}</span>
                : missing(league) === 0
                  ? <span className="sa-state sa-ok">Tutte consegnate</span>
                  : <span className="sa-state sa-warn">{missing(league)} {missing(league) === 1 ? "manca" : "mancano"}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="sa-muted">Nessuna lega in questa stagione.</p>}
      {hidden > 0 || leagues.test > 0 ? (
        <p className="sa-muted sa-small">
          {[hidden > 0 ? `Altre ${hidden} nelle formazioni` : "", leagues.test > 0 ? `Escluse ${leagues.test} di prova` : ""].filter(Boolean).join(" · ")}.
        </p>
      ) : null}
      <Link href="/admin/formazioni" className="db-more">Tutte le formazioni</Link>
    </section>
  );
}

/** Prima quello che non va, poi le persone, la giornata e le leghe. */
export function DashboardView({ data }: { data: DashboardData }) {
  return (
    <div className="db">
      <Status problems={data.problems} />
      <div className="db-grid">
        <People people={data.people} />
        <Matchday week={data.week} />
        <Leagues leagues={data.leagues} week={data.week} />
      </div>
    </div>
  );
}
