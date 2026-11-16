import Link from "next/link";
import { DeadlineCountdown } from "@/components/home/DeadlineCountdown";
import { LeagueOnboarding } from "@/components/home/LeagueOnboarding";
import type { HomeBoard } from "@/lib/server/home-board";

function points(value: number | null) {
  if (value == null) return "—";
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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

function Mark({ letter }: { letter: string }) {
  return <span className="face-mark" aria-hidden="true">{letter.slice(0, 1).toUpperCase()}</span>;
}

export function HomeDashboard({ board }: { board: HomeBoard }) {
  const focus = board.focus;
  const leagueId = focus?.id ?? null;
  const formazione = leagueId ? `/leghe/${leagueId}?tab=formazione` : "/rosa";
  const voti = leagueId ? `/leghe/${leagueId}?tab=risultati` : "/leghe";
  const impostazioni = leagueId ? `/leghe/${leagueId}?tab=lega` : "/leghe";
  const initial = (board.teamName.trim()[0] ?? "F").toUpperCase();
  const last = focus?.lastRound ?? null;
  const duel = Boolean(last?.otherName);

  if (!focus) {
    return (
      <section className="home-dash">
        <article className="hero-card">
          <p className="hero-kicker">{board.competitionName}</p>
          <Jersey letter={initial} />
          <h1>{board.teamName}</h1>
        </article>
        <LeagueOnboarding variant="card" />
      </section>
    );
  }

  return (
    <section className="home-dash">
      <article className="hero-card">
        <p className="hero-kicker">{focus.name}</p>
        <h1>{board.teamName}</h1>
        <Jersey letter={initial} />
        <div className="hero-tools">
          <Link href="/rosa" aria-label="Rosa"><ShirtIcon /></Link>
          <Link href={impostazioni} aria-label="Impostazioni"><GearIcon /></Link>
        </div>
      </article>

      <div className="stat-strip">
        <article><strong>{place(focus.rank)}</strong><span>Posizione</span></article>
        <article><strong>{points(focus.average)}</strong><span>Media</span></article>
        <article><strong>{focus.played}</strong><span>Giornate</span></article>
        <article><strong>{points(focus.total)}</strong><span>Pt. totali</span></article>
      </div>

      <article className="card dash-block">
        <div className="dash-block-head">
          <h2>Giornata precedente</h2>
          <span>{duel ? "Scontro diretto" : focus.rank != null ? `${focus.rank}° sul totale` : "Sul totale"}</span>
        </div>
        {last && duel ? (
          <div className="versus">
            <div className="side">
              <Mark letter={initial} />
              <small>{board.teamName}</small>
              <strong>{points(last.points)}</strong>
            </div>
            <span className="mid">G{last.number}</span>
            <div className="side">
              <Mark letter={last.otherName ?? "A"} />
              <small>{last.otherName}</small>
              <strong>{points(last.otherPoints)}</strong>
            </div>
          </div>
        ) : last ? (
          <div className="total-round">
            <strong>{points(last.points)}</strong>
            <p>Giornata {last.number} · {last.points >= last.average ? "sopra" : "sotto"} la media di lega ({points(last.average)})</p>
          </div>
        ) : <p>Nessuna giornata calcolata.</p>}
        <div className="round-foot">
          <Link href={voti}>Voti e pagelle</Link>
        </div>
      </article>

      <article className="card dash-block current-round">
        <div className="dash-block-head">
          <h2>Giornata corrente</h2>
          <span>{[board.deadlineLabel, focus.nextRival ? "scontro diretto" : "sul totale"].filter(Boolean).join(" · ")}</span>
        </div>
        {focus.nextRival ? (
          <div className="versus">
            <div className="side">
              <Mark letter={initial} />
              <small>{board.teamName}</small>
            </div>
            {board.deadlineAt ? <DeadlineCountdown deadlineAt={board.deadlineAt} label="" compact /> : <span className="mid">—</span>}
            <div className="side">
              <Mark letter={focus.nextRival} />
              <small>{focus.nextRival}</small>
            </div>
          </div>
        ) : board.deadlineAt ? (
          <DeadlineCountdown deadlineAt={board.deadlineAt} label="" compact />
        ) : <p>Nessuna deadline aperta.</p>}
        <div className="dash-actions">
          <Link className="primary" href={formazione}>Inserisci Formazione</Link>
          <a className="text-link" href={board.probabiliHref} target="_blank" rel="noreferrer">Probabili e altro</a>
        </div>
      </article>

      {board.promo ? (
        <a className="promo-banner" href={board.promo.href ?? undefined} target={board.promo.href ? "_blank" : undefined} rel="noreferrer">
          <img src={board.promo.imageUrl} alt={board.promo.label ?? ""} />
          {board.promo.label ? <span>{board.promo.label}</span> : null}
        </a>
      ) : null}

      {focus.recent.length > 0 ? (
        <article className="card dash-block">
          <h2>Ultime giornate</h2>
          <div className="recent-row">
            {focus.recent.map((dot) => (
              <div key={dot.number} className="recent-dot" data-up={dot.above}>
                <span className="recent-mark">{dot.number}</span>
                <strong>{dot.otherPoints != null ? `${points(dot.points)}–${points(dot.otherPoints)}` : points(dot.points)}</strong>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {focus.insights.length > 0 ? (
        <article className="press-room">
          <h2>La tua sala stampa</h2>
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

function ShirtIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5 12 8l4-2.5 4 3-2.2 3.2H16V20H8V9.2H6.2L4 8.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
