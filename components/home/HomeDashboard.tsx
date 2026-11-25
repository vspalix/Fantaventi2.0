import Link from "next/link";
import { DeadlineCountdown } from "@/components/home/DeadlineCountdown";
import { LeagueOnboarding } from "@/components/home/LeagueOnboarding";
import { TeamSettings } from "@/components/home/TeamSettings";
import type { HomeBoard } from "@/lib/server/home-board";

function points(value: number | null) {
  if (value == null) return "—";
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function place(rank: number | null) {
  if (rank == null) return "—";
  return `${rank}ª`;
}

function Crest({ name, primary, secondary, logoUrl }: { name: string; primary: string; secondary: string; logoUrl: string }) {
  if (logoUrl) return <img className="team-crest" src={logoUrl} alt="" />;
  const letter = (name.trim()[0] ?? "F").toUpperCase();
  return (
    <svg className="jersey" viewBox="0 0 64 76" aria-hidden="true">
      <path d="M16 18c4-8 8-10 16-10s12 2 16 10l10 8-8 10h-6v32H20V36h-6L6 26z" fill={primary} />
      <path d="M32 8c6 0 10 2 14 10l10 8-8 10h-6v32H32z" fill={secondary} />
      <path d="M26 10h12l-6 9z" fill="#09090b" />
      <text x="32" y="48" textAnchor="middle" fontSize="16" fontWeight="700" fill="#09090b">{letter}</text>
    </svg>
  );
}

function Mark({ letter }: { letter: string }) {
  return <span className="face-mark" aria-hidden="true">{letter.slice(0, 1).toUpperCase()}</span>;
}

export function HomeDashboard({ board }: { board: HomeBoard; logoUrl?: string }) {
  const focus = board.focus;
  const leagueId = focus?.id ?? null;
  const formazione = leagueId ? `/leghe/${leagueId}?tab=formazione` : "/rosa";
  const voti = leagueId ? `/leghe/${leagueId}?tab=pagelle` : "/leghe";
  const initial = (board.teamName.trim()[0] ?? "F").toUpperCase();
  const last = focus?.lastRound ?? null;
  const duel = Boolean(last?.otherName);
  const crest = (
    <Crest name={board.teamName} primary={board.teamPrimary} secondary={board.teamSecondary} logoUrl={board.teamLogoUrl} />
  );

  if (!focus) {
    return (
      <section className="home-dash">
        <article className="hero-card">
          {crest}
          <div className="hero-copy">
            <p className="hero-kicker">{board.competitionName}</p>
            <h1>{board.teamName}</h1>
          </div>
        </article>
        <LeagueOnboarding variant="card" />
      </section>
    );
  }

  return (
    <section className="home-dash">
      <article className="hero-card">
        {crest}
        <div className="hero-copy">
          <p className="hero-kicker">{focus.name}</p>
          <h1>{board.teamName}</h1>
        </div>
        {board.teamId ? (
          <TeamSettings look={{ teamId: board.teamId, name: board.teamName, primary: board.teamPrimary, secondary: board.teamSecondary, logoUrl: board.teamLogoUrl }} />
        ) : null}
      </article>

      <div className="stat-strip">
        <article><strong>{place(focus.rank)}</strong><span>Posizione</span></article>
        <article><strong>{points(last?.points ?? null)}</strong><span>{last ? `G${last.number}` : "Ultima"}</span></article>
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
            <p>Giornata {last.number} · {Math.abs(last.points - last.average) < 1 ? "in linea con" : last.points > last.average ? "sopra" : "sotto"} la media di lega ({points(last.average)})</p>
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
              <div key={dot.number} className="recent-dot" data-tone={dot.tone}>
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
              <p className="press-card" data-tone={line.tone} key={line.text}>
                <span className="press-badge">{line.badge}</span>
                {line.text}
              </p>
            ))}
          </div>
        </article>
      ) : null}

      {board.sponsors.items.length > 0 ? (
        <section className="sponsor-block" aria-label="Sponsor">
          <h2>Sponsor</h2>
          <div className="sponsor-rail" style={{ ["--sponsor-seconds" as string]: `${board.sponsors.scrollSeconds}s` }}>
            <div className="sponsor-track">
              {[0, 1].map((copy) => (
                <div className="sponsor-set" key={copy}>
                  {board.sponsors.items.map((item) => {
                    const body = item.imageUrl
                      ? <img src={item.imageUrl} alt={item.label} />
                      : <span>Sponsored by {item.label}</span>;
                    return item.href ? (
                      <a key={`${copy}-${item.id}`} href={item.href} target="_blank" rel="noreferrer">{body}</a>
                    ) : <span key={`${copy}-${item.id}`}>{body}</span>;
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
