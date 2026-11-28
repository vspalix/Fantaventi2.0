import Link from "next/link";
import type { ReactNode } from "react";
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

/** Un riquadro del pannello: titolo a sinistra, collegamento alla sezione a destra. */
function Panel({ title, extra, link, children }: { title: string; extra?: ReactNode; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className="sa-card db-panel" aria-label={title}>
      <header>
        <h2 className="sa-cap">{title}</h2>
        {extra}
        {link ? <Link href={link.href}>{link.label} <span aria-hidden="true">›</span></Link> : null}
      </header>
      {children}
    </section>
  );
}

function Tiles({ items }: { items: { value: number; total?: number; label: string }[] }) {
  return (
    <ul className="db-tiles">
      {items.map((item) => (
        <li key={item.label}>
          <b>{item.value}{item.total === undefined ? null : <span>/{item.total}</span>}</b>
          <small>{item.label}</small>
        </li>
      ))}
    </ul>
  );
}

function Status({ problems }: { problems: DashboardData["problems"] }) {
  if (problems.length === 0) {
    return (
      <section className="sa-card db-panel db-calm" aria-label="Stato dell'app">
        <span className="db-check" aria-hidden="true">✓</span>
        <strong>Tutto a posto</strong>
        <span className="sa-muted">Nessun problema</span>
      </section>
    );
  }
  return (
    <section className="sa-card db-panel db-alerts" aria-label="Stato dell'app">
      <header><h2 className="sa-cap">Da controllare · {problems.length}</h2></header>
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
      <Panel title="Persone">
        <p className="sa-muted">Dati non disponibili in questo momento.</p>
      </Panel>
    );
  }
  const top = Math.max(1, ...people.weekly);
  return (
    <Panel title="Persone" link={{ href: "/admin/utenti", label: "Utenti" }}>
      <div className="db-people">
        <div className="db-hero">
          <b>{people.users}</b>
          <span>
            {people.users === 1 ? "iscritta" : "iscritte"}
            <small className={people.newThisWeek > 0 ? "sa-ok" : "sa-muted"}>
              {people.newThisWeek > 0 ? `+${people.newThisWeek} in 7 giorni` : "Nessuna nuova"}
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
                  <span style={{ height: `${Math.round((count / top) * 26) + 3}px` }} />
                </li>
              );
            })}
          </ol>
          <figcaption>Nuovi iscritti, {people.weekly.length} settimane</figcaption>
        </figure>
      </div>
      <Tiles
        items={[
          { value: people.playing, total: people.users, label: `Attivi (${PLAYING_DAYS} gg)` },
          { value: people.withPush, total: people.users, label: "Notifiche attive" },
          { value: people.withoutLeague, label: "Senza una lega" },
        ]}
      />
      {people.testUsers > 0 ? <p className="db-note">Esclusi {people.testUsers} account di prova.</p> : null}
    </Panel>
  );
}

function Matchday({ week }: { week: DashboardData["week"] }) {
  if (!week) {
    return (
      <Panel title="Giornata">
        <p className="sa-muted">Nessuna giornata in calendario.</p>
      </Panel>
    );
  }
  const status = week.status === "open" && week.locked ? "In corso" : WEEK_STATUS[week.status] ?? week.status;
  return (
    <Panel
      title={`Giornata ${week.number}`}
      extra={<span className="sa-chip sa-chip-league">{status}</span>}
      link={{ href: "/admin/giornata", label: "Apri" }}
    >
      <Tiles
        items={[
          { value: week.lineups.filed, total: week.lineups.teams, label: "Formazioni" },
          { value: week.matches.played, total: week.matches.total, label: "Partite giocate" },
          { value: week.matches.live, label: "In corso ora" },
        ]}
      />
      <dl className="db-facts">
        <div>
          <dt>{week.locked ? "Formazioni chiuse" : "Chiusura formazioni"}</dt>
          <dd>{dashboardWhen(week.deadlineAt)}</dd>
        </div>
        <div>
          <dt>Ultima lettura voti</dt>
          <dd>{week.lastVoteRead ? `${dashboardWhen(week.lastVoteRead.at)} · ${READ_OUTCOME[week.lastVoteRead.outcome] ?? week.lastVoteRead.outcome}` : "Non ancora"}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function Leagues({ leagues, week }: { leagues: DashboardData["leagues"]; week: DashboardData["week"] }) {
  const missing = (league: DashboardData["leagues"]["rows"][number]) => league.teams - league.filed;
  const shown = [...leagues.rows]
    .sort((left, right) => missing(right) - missing(left) || right.teams - left.teams || left.name.localeCompare(right.name, "it"))
    .slice(0, LEAGUES_SHOWN);
  const hidden = leagues.rows.length - shown.length;
  const teams = (count: number) => `${count} ${count === 1 ? "squadra" : "squadre"}`;
  return (
    <Panel
      title={`Leghe · ${leagues.rows.length}`}
      extra={<span className="sa-muted db-sub">{teams(leagues.teams)}</span>}
      link={{ href: "/admin/formazioni", label: "Formazioni" }}
    >
      {shown.length > 0 ? (
        <dl className="db-facts">
          {shown.map((league) => (
            <div key={league.id}>
              <dt className="db-name">{league.name}</dt>
              <dd>
                {!week || league.teams === 0
                  ? teams(league.teams)
                  : missing(league) === 0
                    ? <span className="sa-ok">Tutte consegnate</span>
                    : <span className="sa-warn">{missing(league)} {missing(league) === 1 ? "manca" : "mancano"}</span>}
              </dd>
            </div>
          ))}
        </dl>
      ) : <p className="sa-muted">Nessuna lega in questa stagione.</p>}
      {hidden > 0 || leagues.test > 0 ? (
        <p className="db-note">
          {[hidden > 0 ? `Altre ${hidden} nelle formazioni` : "", leagues.test > 0 ? `Escluse ${leagues.test} di prova` : ""].filter(Boolean).join(" · ")}.
        </p>
      ) : null}
    </Panel>
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
