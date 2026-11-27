import Link from "next/link";
import { CurrentRound } from "@/components/home/CurrentRound";
import { LeagueOnboarding } from "@/components/home/LeagueOnboarding";
import { Mark } from "@/components/home/Mark";
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

export function HomeDashboard({ board }: { board: HomeBoard; logoUrl?: string }) {
  const focus = board.focus;
  const leagueId = focus?.id ?? null;
  const voti = leagueId ? `/leghe/${leagueId}?tab=pagelle` : "/leghe";
  const initial = (board.teamName.trim()[0] ?? "F").toUpperCase();
  const last = focus?.lastRound ?? null;
  const duel = Boolean(last?.otherName);
  const gap = last ? last.points - last.average : 0;
  const roundTone = !last ? "mid" : Math.abs(gap) < 1 ? "mid" : gap > 0 ? "up" : "down";
  const roundDelta = !last
    ? ""
    : roundTone === "mid"
      ? `In linea con la media di lega (${points(last.average)})`
      : `${gap > 0 ? "+" : "−"}${points(Math.abs(gap))} rispetto alla media di lega (${points(last.average)})`;
  const crest = (
    <Crest name={board.teamName} primary={board.teamPrimary} secondary={board.teamSecondary} logoUrl={board.teamLogoUrl} />
  );

  if (!focus) {
    return (
      <section className="home-dash">
        <article className="hero-card">
          <div className="hero-top">
            {crest}
            <div className="hero-copy">
              <p className="hero-kicker">{board.competitionName}</p>
              <h1>{board.teamName}</h1>
            </div>
          </div>
        </article>
        <LeagueOnboarding />
      </section>
    );
  }

  return (
    <section className="home-dash">
      <article className="hero-card">
        <div className="hero-top">
          {crest}
          <div className="hero-copy">
            <p className="hero-kicker">{focus.name}</p>
            <h1>{board.teamName}</h1>
          </div>
          {board.teamId ? (
            <TeamSettings key={board.teamId} look={{ teamId: board.teamId, name: board.teamName, primary: board.teamPrimary, secondary: board.teamSecondary, logoUrl: board.teamLogoUrl }} />
          ) : null}
        </div>
        <div className="stat-strip">
          <div className="stat-cell stat-main"><strong>{place(focus.rank)}</strong><span>Posizione</span></div>
          <div className="stat-cell"><strong>{points(focus.total)}</strong><span>Punti totali</span></div>
          <div className="stat-cell"><strong>{focus.played}</strong><span>Giornate giocate</span></div>
        </div>
      </article>

      <CurrentRound
        key={focus.id}
        leagueId={focus.id}
        teamName={board.teamName}
        rival={focus.nextRival}
        liveRound={focus.liveRound}
        nextRound={focus.nextRound}
        deadlineAt={board.deadlineAt}
        deadlineRound={board.deadlineRound}
        probabiliHref={board.probabiliHref}
      />

      {board.promo ? (
        <a className="promo-banner" href={board.promo.href ?? undefined} target={board.promo.href ? "_blank" : undefined} rel="noreferrer">
          <img src={board.promo.imageUrl} alt={board.promo.label ?? ""} />
          {board.promo.label ? <span>{board.promo.label}</span> : null}
        </a>
      ) : null}

      <article className="card dash-block last-round">
        <div className="dash-block-head">
          <h2>{last ? `Giornata ${last.number}` : "Giornata precedente"}</h2>
          <span>{duel ? "Scontro diretto" : "Ultima giocata"}</span>
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
          <div className="round-score">
            <strong>{points(last.points)}<small>punti</small></strong>
            <p className="round-delta" data-tone={roundTone}>{roundDelta}</p>
          </div>
        ) : <p>Nessuna giornata calcolata.</p>}
        {focus.recent.length > 0 ? (
          <div className="recent-block">
            <p className="recent-label">Andamento <span>Tocca per la classifica</span></p>
            <div className="recent-row">
              {focus.recent.map((dot) => {
                const score = dot.otherPoints != null ? `${points(dot.points)}–${points(dot.otherPoints)}` : points(dot.points);
                return (
                  <Link
                    key={dot.number}
                    className="recent-dot"
                    data-tone={dot.tone}
                    data-current={dot.number === last?.number}
                    href={`/leghe/${focus.id}?tab=risultati&giornata=${dot.number}&formazione=mia`}
                    aria-label={`Giornata ${dot.number}, ${score} punti: apri la giornata con la tua formazione`}
                  >
                    <span className="recent-mark">{dot.number}</span>
                    <strong>{score}</strong>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="round-foot">
          {last ? <Link href={`/leghe/${focus.id}?tab=risultati&giornata=${last.number}`}>Classifica di giornata</Link> : null}
          <Link href={voti}>Voti e pagelle</Link>
        </div>
      </article>

      {focus.insights.length > 0 ? (
        <article className="card dash-block press-room">
          <div className="dash-block-head">
            <h2>La tua sala stampa</h2>
          </div>
          <div className="press-row">
            {focus.insights.map((line) => (
              <p className="press-card" data-tone={line.tone} key={line.text}>
                <span className="press-badge">{line.badge}</span>
                <span className="press-text">{line.text}</span>
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
