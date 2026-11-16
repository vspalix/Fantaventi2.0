import Link from "next/link";
import { DeadlineCountdown } from "@/components/home/DeadlineCountdown";
import { LeagueOnboarding } from "@/components/home/LeagueOnboarding";
import type { HomeBoard } from "@/lib/server/home-board";

function points(value: number | null) {
  if (value == null) return "—";
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function place(rank: number | null) {
  if (rank == null) return "—";
  return `${rank}ª`;
}

function Jersey({ letter }: { letter: string }) {
  return (
    <svg className="jersey" viewBox="0 0 64 76" aria-hidden="true">
      <path d="M16 18c4-8 8-10 16-10s12 2 16 10l10 8-8 10h-6v32H20V36h-6L6 26z" fill="#c6f531" />
      <path d="M32 8c6 0 10 2 14 10l10 8-8 10h-6v32H32z" fill="#f4f4f5" />
      <path d="M26 10h12l-6 9z" fill="#09090b" />
      <text x="32" y="48" textAnchor="middle" fontSize="16" fontWeight="700" fill="#09090b">{letter}</text>
    </svg>
  );
}

export function HomeDashboard({ board }: { board: HomeBoard }) {
  const focus = board.focus;
  const leagueId = focus?.id ?? null;
  const formazione = leagueId ? `/leghe/${leagueId}?tab=formazione` : "/rosa";
  const voti = leagueId ? `/leghe/${leagueId}?tab=risultati` : "/leghe";
  const initial = (board.teamName.trim()[0] ?? "F").toUpperCase();

  if (!focus) {
    return (
      <section className="stack home-dash">
        <article className="identity">
          <Jersey letter={initial} />
          <div>
            <p className="small muted">{board.competitionName}</p>
            <h1>{board.teamName}</h1>
          </div>
        </article>
        <LeagueOnboarding variant="card" />
      </section>
    );
  }

  return (
    <section className="stack home-dash">
      <article className="identity">
        <Jersey letter={initial} />
        <div className="identity-copy">
          <p className="small muted">{focus.name}</p>
          <h1>{board.teamName}</h1>
        </div>
        <div className="identity-actions">
          <Link className="ghost" href="/rosa">Rosa</Link>
          <Link className="ghost" href={formazione}>Formazione</Link>
        </div>
      </article>

      <div className="stat-grid">
        <article><span>Pos</span><strong>{place(focus.rank)}</strong></article>
        <article><span>Media</span><strong>{points(focus.average)}</strong></article>
        <article><span>G</span><strong>{focus.played}</strong></article>
        <article><span>PT</span><strong>{points(focus.total)}</strong></article>
      </div>

      <article className="card dash-block">
        <div className="dash-block-head">
          <h2>Giornata precedente</h2>
          <Link href={voti}>Voti</Link>
        </div>
        {focus.lastRound ? (
          <div className="last-round">
            <strong>{points(focus.lastRound.points)}</strong>
            <p>Giornata {focus.lastRound.number} · media di lega {points(focus.lastRound.average)}</p>
          </div>
        ) : <p>Nessuna giornata calcolata.</p>}
      </article>

      <article className="card dash-block">
        <h2>{board.deadlineLabel ?? "Giornata"}</h2>
        {board.deadlineAt && board.deadlineLabel ? (
          <DeadlineCountdown deadlineAt={board.deadlineAt} label="Al blocco formazioni" />
        ) : <p>Nessuna deadline aperta.</p>}
        <div className="dash-actions">
          <Link className="primary" href={formazione}>Inserisci Formazione</Link>
          <a className="ghost" href={board.probabiliHref} target="_blank" rel="noreferrer">Probabili e altro</a>
        </div>
      </article>

      {board.promo ? (
        <a className="promo-banner" href={board.promo.href ?? undefined} target={board.promo.href ? "_blank" : undefined} rel="noreferrer">
          <img src={board.promo.imageUrl} alt={board.promo.label ?? ""} />
        </a>
      ) : null}

      {focus.recent.length > 0 ? (
        <article className="card dash-block">
          <h2>Ultime giornate</h2>
          <div className="recent-row">
            {focus.recent.map((dot) => (
              <div key={dot.number} className="recent-dot" data-up={dot.above}>
                <strong>{points(dot.points)}</strong>
                <span>{dot.number}</span>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {focus.insights.length > 0 ? (
        <article className="dash-block">
          <h2>Sala stampa</h2>
          <div className="press-row">
            {focus.insights.map((line) => (
              <p className="press-card" key={line}>{line}</p>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
}
