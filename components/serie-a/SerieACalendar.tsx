"use client";

import { useState } from "react";
import { InfoTip } from "@/components/InfoTip";
import { ClubPair } from "@/components/TeamBadge";
import type { SerieARound } from "@/lib/server/serie-a-calendar";

const kickoff = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

export function SerieACalendar({ title, focus, rounds }: { title: string; focus: number; rounds: SerieARound[] }) {
  const [number, setNumber] = useState(focus);
  const index = Math.max(0, rounds.findIndex((round) => round.number === number));
  const current = rounds[index] ?? null;

  return (
    <section className="stack">
      <header className="page-head">
        <h1 className="section-title">Calendario {title}</h1>
        <p className="small muted">Campionato <InfoTip label="Calendario Serie A">Gli incontri del campionato. I punti della lega restano nella tab Calendario.</InfoTip></p>
      </header>
      <div className="gw-stepper">
        <button className="ghost" type="button" aria-label="Giornata precedente" disabled={index <= 0} onClick={() => { const previous = rounds[index - 1]; if (previous) setNumber(previous.number); }}>‹</button>
        <select aria-label="Giornata di campionato" value={current?.number ?? ""} onChange={(event) => setNumber(Number(event.target.value))}>
          {rounds.map((round) => <option key={round.number} value={round.number}>Giornata {round.number}</option>)}
        </select>
        <button className="ghost" type="button" aria-label="Giornata successiva" disabled={index >= rounds.length - 1} onClick={() => { const next = rounds[index + 1]; if (next) setNumber(next.number); }}>›</button>
      </div>
      <article className="card">
        {!current || current.matches.length === 0 ? <p className="small muted">Nessun incontro in questa giornata.</p> : (
          <div className="cal-matches">
            {current.matches.map((match) => {
              const scored = match.homeGoals != null && match.awayGoals != null;
              return (
                <p className="cal-match" key={match.id}>
                  <ClubPair home={match.home} away={match.away} score={scored ? `${match.homeGoals}–${match.awayGoals}` : null} />
                  <span className="small muted">{scored ? "Finale" : kickoff.format(new Date(match.kickoffAt))}</span>
                </p>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
