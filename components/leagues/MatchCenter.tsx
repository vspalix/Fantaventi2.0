"use client";

import { useEffect, useState } from "react";
import { PushOptIn } from "@/components/PushOptIn";
import type { LiveCenter } from "@/lib/server/live-center";

const ROLE_ROW: Record<string, number> = { GK: 1, DEF: 2, MID: 3, FWD: 4 };

export function MatchCenter({ leagueId }: { leagueId: string }) {
  const [live, setLive] = useState<LiveCenter | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch(`/api/leagues/${leagueId}/live`);
        const body = (await response.json()) as { live?: LiveCenter; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Live non disponibile.");
        if (!stop) {
          setLive(body.live ?? null);
          setError(null);
        }
      } catch (reason) {
        if (!stop) setError(reason instanceof Error ? reason.message : "Live non disponibile.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [leagueId]);

  const rows = ["GK", "DEF", "MID", "FWD"].map((role) => ({
    role,
    players: (live?.mine?.starters ?? []).filter((player) => player.role === role).sort((left, right) => ROLE_ROW[left.role] - ROLE_ROW[right.role]),
  })).filter((row) => row.players.length > 0);
  const maxBar = Math.max(1, ...(live?.table ?? []).map((row) => row.points));

  return (
    <div className="stack">
      <section className="card stack">
        <header className="row">
          <div>
            <h2>Live</h2>
            <p className="small muted">
              {live?.gameweekNumber ? `Giornata ${live.gameweekNumber}` : "Nessuna giornata aperta"}
              {live?.phase === "countdown" ? " · in attesa del calcio d'inizio" : ""}
              {live?.checkedAt ? ` · ${new Date(live.checkedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          </div>
          <PushOptIn />
        </header>
        {error ? <p className="banner">{error}</p> : null}
        {live?.mine ? (
          <div className="stadium">
            {rows.map((row) => (
              <div className="stadium-row" key={row.role}>
                {row.players.map((player) => (
                  <article className="stadium-player" key={player.id}>
                    <strong>{player.name}</strong>
                    <span className="vote-badge">{player.voto == null ? "—" : player.voto.toLocaleString("it-IT")}</span>
                    <span className="small">{chip(player.bonus, player.malus)}</span>
                  </article>
                ))}
              </div>
            ))}
            <p className="small">Parziale {live.mine.total.toLocaleString("it-IT")} · {live.mine.teamName}</p>
          </div>
        ) : <p>Nessuna formazione da seguire in questa giornata.</p>}
        {live?.mine && live.mine.bench.length > 0 ? (
          <div className="stack">
            <h3>Panchina</h3>
            <div className="row">
              {live.mine.bench.map((player) => (
                <span className="chip" key={player.id}>{player.name} {player.voto == null ? "" : player.voto.toLocaleString("it-IT")}</span>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {live?.opponent ? (
        <section className="card stack">
          <h2>Scontro diretto</h2>
          <p className="scoreline">{live.opponent.goalsFor} – {live.opponent.goalsAgainst}</p>
          <p>{live.mine?.teamName} contro {live.opponent.teamName}. Gol dalle soglie della lega, fantapunti {live.mine?.total.toLocaleString("it-IT")} a {live.opponent.total.toLocaleString("it-IT")}.</p>
        </section>
      ) : null}
      <section className="card stack">
        <h2>{live?.mode === "head_to_head" ? "Classifica live" : live?.mode === "knockout" ? "Coppa, fuori dalla classifica" : "Proiezione classifica"}</h2>
        {(live?.table ?? []).map((row) => (
          <div className="bar-row" key={row.teamName}>
            <span>{row.teamName}</span>
            <span className="bar"><span style={{ width: `${Math.max(8, (row.points / maxBar) * 100)}%` }} /></span>
            <strong>{row.points.toLocaleString("it-IT")}</strong>
          </div>
        ))}
      </section>
      <section className="card stack">
        <h2>Eventi dei titolari</h2>
        {(live?.events.length ?? 0) === 0 ? <p>Nessun gol, bonus o cartellino pubblicato finora.</p> : (
          <ol className="event-feed">
            {live?.events.map((event, index) => (
              <li key={`${event.playerName}-${event.label}-${index}`}>{event.playerName} · {event.teamName} · {event.label}</li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function chip(bonus: number, malus: number) {
  const parts: string[] = [];
  if (bonus !== 0) parts.push(`${bonus > 0 ? "+" : ""}${bonus.toLocaleString("it-IT")}`);
  if (malus !== 0) parts.push(malus.toLocaleString("it-IT"));
  return parts.join(" ") || "niente bonus";
}
