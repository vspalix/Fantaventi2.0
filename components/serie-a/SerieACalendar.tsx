"use client";

import { useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import type { MyCalendarPlayers, SerieAMatch, SerieARound } from "@/lib/server/serie-a-calendar";
import type { PlayerRole } from "@/lib/types";

const ROLE: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };

const dayName = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" });
const hour = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

/** Le partite sono già in ordine di orario: si aprono i giorni man mano. */
function byDay(matches: SerieAMatch[]) {
  const days: { name: string; matches: SerieAMatch[] }[] = [];
  for (const match of matches) {
    const name = dayName.format(new Date(match.kickoffAt));
    const last = days[days.length - 1];
    if (last?.name === name) last.matches.push(match);
    else days.push({ name, matches: [match] });
  }
  return days;
}

function Mine({ players }: { players: MyCalendarPlayers["players"] }) {
  return (
    <span className="cs-mine-side">
      {players.map((player) => (
        <span className="cs-player" key={player.id}>
          <span className="role-chip" data-role={player.role}>{ROLE[player.role]}</span>
          <span>{player.name}</span>
        </span>
      ))}
    </span>
  );
}

export function SerieACalendar({
  title,
  focus,
  rounds,
  mine,
}: {
  title: string;
  focus: number;
  rounds: SerieARound[];
  mine: MyCalendarPlayers | null;
}) {
  const [number, setNumber] = useState(focus);
  const index = Math.max(0, rounds.findIndex((round) => round.number === number));
  const current = rounds[index] ?? null;
  const squad = (mine?.players ?? []).filter((player) => current && player.from <= current.number && (player.until === null || player.until >= current.number));
  const ofClub = (clubId: string) => squad.filter((player) => player.clubId === clubId);

  return (
    <section className="stack cs">
      <header className="cs-head">
        {/* Il nome del campionato resta unito quando il titolo va a capo. */}
        <h1 className="section-title">Calendario {title.replaceAll(" ", " ")}</h1>
        {mine && squad.length > 0 ? <p>Sotto ogni partita i tuoi calciatori · {mine.leagueName}</p> : null}
      </header>
      <div className="gw-stepper">
        <button className="ghost" type="button" aria-label="Giornata precedente" disabled={index <= 0} onClick={() => { const previous = rounds[index - 1]; if (previous) setNumber(previous.number); }}>‹</button>
        <select aria-label="Giornata di campionato" value={current?.number ?? ""} onChange={(event) => setNumber(Number(event.target.value))}>
          {rounds.map((round) => <option key={round.number} value={round.number}>Giornata {round.number}</option>)}
        </select>
        <button className="ghost" type="button" aria-label="Giornata successiva" disabled={index >= rounds.length - 1} onClick={() => { const next = rounds[index + 1]; if (next) setNumber(next.number); }}>›</button>
      </div>
      {!current || current.matches.length === 0 ? <p className="small muted">Nessun incontro in questa giornata.</p> : byDay(current.matches).map((day) => (
        <section className="cs-day" key={day.name}>
          <h2>{day.name}</h2>
          <ul>
            {day.matches.map((match) => {
              const scored = match.homeGoals != null && match.awayGoals != null;
              const home = ofClub(match.homeClubId);
              const away = ofClub(match.awayClubId);
              return (
                <li className="cs-match" key={match.id}>
                  <div className="cs-team">
                    <TeamBadge teamName={match.home} size={30} />
                    <span>{match.homeName}</span>
                  </div>
                  <div className="cs-middle">
                    {scored ? (
                      <>
                        <strong className="cs-score">{match.homeGoals} – {match.awayGoals}</strong>
                        <small>Finale</small>
                      </>
                    ) : <strong className="cs-time">{hour.format(new Date(match.kickoffAt))}</strong>}
                  </div>
                  <div className="cs-team">
                    <TeamBadge teamName={match.away} size={30} />
                    <span>{match.awayName}</span>
                  </div>
                  {home.length > 0 || away.length > 0 ? (
                    <div className="cs-mine" aria-label="I tuoi calciatori in questa partita">
                      <Mine players={home} />
                      <Mine players={away} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
