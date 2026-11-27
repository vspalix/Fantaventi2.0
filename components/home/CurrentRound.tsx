"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DeadlineCountdown } from "@/components/home/DeadlineCountdown";
import { Mark } from "@/components/home/Mark";

/**
 * La giornata in Dashboard. Prima della deadline: conto alla rovescia e «Inserisci Formazione».
 * A giornata in corso: niente conto alla rovescia, si va al Live con la propria formazione.
 */
export function CurrentRound({
  leagueId,
  teamName,
  rival,
  liveRound,
  nextRound,
  deadlineAt,
  deadlineRound,
  probabiliHref,
}: {
  leagueId: string;
  teamName: string;
  rival: string | null;
  liveRound: number | null;
  nextRound: number | null;
  deadlineAt: string | null;
  deadlineRound: number | null;
  probabiliHref: string;
}) {
  // La deadline può passare con la Dashboard aperta: da quel momento la giornata è in corso.
  const startsAt = liveRound === null && nextRound !== null && nextRound === deadlineRound ? deadlineAt : null;
  const [started, setStarted] = useState<string | null>(null);

  useEffect(() => {
    if (!startsAt) return;
    const check = () => {
      if (Date.now() >= new Date(startsAt).getTime()) setStarted(startsAt);
    };
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [startsAt]);

  const live = liveRound ?? (startsAt && started === startsAt ? nextRound : null);
  const number = live ?? deadlineRound;
  const middle = live !== null
    ? <p className="clock-pill" data-live="true">In corso</p>
    : deadlineAt ? <DeadlineCountdown deadlineAt={deadlineAt} label="" compact /> : null;

  return (
    <article className="card dash-block current-round">
      <div className="dash-block-head">
        <h2>Giornata corrente</h2>
        <span>{[number === null ? null : `Giornata ${number}`, rival ? "scontro diretto" : "sul totale"].filter(Boolean).join(" · ")}</span>
      </div>
      {rival ? (
        <div className="versus">
          <div className="side">
            <Mark letter={teamName.trim()[0] ?? "F"} />
            <small>{teamName}</small>
          </div>
          {middle ?? <span className="mid">—</span>}
          <div className="side">
            <Mark letter={rival} />
            <small>{rival}</small>
          </div>
        </div>
      ) : middle ?? <p>Nessuna deadline aperta.</p>}
      <div className="dash-actions">
        {live !== null ? (
          <Link className="primary" href={`/leghe/${leagueId}?tab=risultati&giornata=${live}&formazione=mia`}>Live</Link>
        ) : (
          <Link className="primary" href={`/leghe/${leagueId}?tab=formazione`}>Inserisci Formazione</Link>
        )}
        <a className="ghost" href={probabiliHref} target="_blank" rel="noreferrer">Probabili e altro</a>
      </div>
    </article>
  );
}
