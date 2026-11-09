import Link from "next/link";
import { DeadlineCountdown } from "@/components/home/DeadlineCountdown";
import { LeagueOnboarding } from "@/components/home/LeagueOnboarding";
import type { HomeBoard, HomeLeagueCard } from "@/lib/server/home-board";

function formatLabel(format: string) {
  if (format === "h2h") return "Scontri diretti";
  if (format === "hybrid") return "Fasi";
  return "Classifica";
}

function LeagueSummary({ card }: { card: HomeLeagueCard }) {
  const place = card.rank == null ? "Non in classifica" : `${card.rank}°`;
  const points = card.total == null ? "" : card.format === "h2h" ? `${card.total} pt` : `${card.total} fantapunti`;
  return (
    <Link className="card" href={`/leghe/${card.id}`}>
      <p className="small muted">{formatLabel(card.format)} · {card.played} giornate</p>
      <h2>{card.name}</h2>
      <p className="rank-line">{place}{points ? ` · ${points}` : ""}</p>
      {card.nextLabel ? <p>{card.nextLabel}</p> : null}
    </Link>
  );
}

export function HomeDashboard({ board }: { board: HomeBoard }) {
  const kickoff = new Intl.DateTimeFormat("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  });

  return (
    <section className="stack">
      <header>
        <p className="small muted">{board.competitionName}</p>
        <h1 className="section-title">La tua giornata</h1>
      </header>
      <article className="card news-feature">
        <h2>News</h2>
        {board.news.length === 0 ? <p>Nessun avviso in questo momento.</p> : (
          <ul className="news-list">
            {board.news.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
                {item.linkUrl ? <a className="primary" href={item.linkUrl} target="_blank" rel="noreferrer">{item.linkLabel ?? "Apri"}</a> : null}
              </li>
            ))}
          </ul>
        )}
      </article>
      <div className="dash-grid">
        {board.leagues.map((card) => <LeagueSummary key={card.id} card={card} />)}
        <LeagueOnboarding variant="card" />
      </div>
      <div className="dash-grid">
        <article className="card">
          <h2>Deadline</h2>
          {board.deadlineAt && board.deadlineLabel ? (
            <DeadlineCountdown deadlineAt={board.deadlineAt} label={board.deadlineLabel} />
          ) : (
            <p>Nessuna deadline aperta in questa stagione.</p>
          )}
        </article>
        <article className="card">
          <h2>Prossime di {board.competitionName}</h2>
          {board.fixtures.length === 0 ? <p>Nessuna partita in programma.</p> : (
            <ul className="fixture-list">
              {board.fixtures.map((fixture) => (
                <li key={fixture.id}>
                  <strong>{fixture.home} – {fixture.away}</strong>
                  <span>{kickoff.format(new Date(fixture.kickoffAt))}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
