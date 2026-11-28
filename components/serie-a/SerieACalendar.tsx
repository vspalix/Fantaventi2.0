"use client";

import { useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { rivalPicks, type ClubPick } from "@/lib/calendar-rivals";
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

function RivalsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2" />
    </svg>
  );
}

function Rival({ pick }: { pick: ClubPick }) {
  return (
    <span className="cs-rival">
      <RivalsIcon />
      <span className="cs-sr">Il più scelto dagli avversari: </span>
      <span className="cs-player-name">{pick.name}</span>
      {pick.ties > 0 ? <span aria-hidden="true">+{pick.ties}</span> : null}
      <span className="cs-rival-share">{pick.percent}%</span>
      {pick.ties > 0 ? <span className="cs-sr">, alla pari con altri {pick.ties}</span> : null}
    </span>
  );
}

/** `starters` è null quando per la giornata non c'è una formazione: nessuna distinzione. */
function Side({ players, starters, rival }: { players: MyCalendarPlayers["players"]; starters: Set<string> | null; rival: ClubPick | undefined }) {
  const benched = (id: string) => starters !== null && !starters.has(id);
  const ordered = [...players].sort((left, right) => Number(benched(left.id)) - Number(benched(right.id)));
  return (
    <span className="cs-mine-side">
      {ordered.map((player) => (
        <span className="cs-player" data-bench={benched(player.id) || undefined} key={player.id}>
          <span className="role-chip" data-role={player.role}>{ROLE[player.role]}</span>
          <span className="cs-player-name">{player.name}</span>
          {starters ? <span className="cs-sr">{benched(player.id) ? ", in panchina" : ", titolare"}</span> : null}
        </span>
      ))}
      {rival ? <Rival pick={rival} /> : null}
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
  const lineup = current ? mine?.starters[current.number] : undefined;
  const starters = lineup ? new Set(lineup) : null;
  const picks = current && mine?.rivals ? rivalPicks(mine.rivals, current.number) : new Map<string, ClubPick>();
  const tied = [...picks.values()].some((pick) => pick.ties > 0);

  return (
    <section className="stack cs">
      <header className="cs-head">
        {/* Il nome del campionato resta unito quando il titolo va a capo. */}
        <h1 className="section-title">Calendario {title.replaceAll(" ", " ")}</h1>
        {mine && squad.length > 0 ? <p>{starters ? "I tuoi titolari in evidenza, la panchina in grigio" : "Sotto ogni partita i tuoi calciatori"} · {mine.leagueName}</p> : null}
        {picks.size > 0 ? (
          <p className="cs-legend">
            <RivalsIcon />
            <span>Il più scelto dagli avversari, con la % delle loro rose{tied ? " (+1: un altro alla pari)" : ""}</span>
          </p>
        ) : null}
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
              const homePick = picks.get(match.homeClubId);
              const awayPick = picks.get(match.awayClubId);
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
                  {home.length > 0 || away.length > 0 || homePick || awayPick ? (
                    <div className="cs-mine" aria-label="I calciatori scelti in questa partita">
                      <Side players={home} starters={starters} rival={homePick} />
                      <Side players={away} starters={starters} rival={awayPick} />
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
