"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useMyLeagues } from "@/components/leagues/MyLeagues";
import type { LeagueSummary } from "@/lib/types";

function roleLabel(league: LeagueSummary) {
  if (!league.isManager) return "Giocatore";
  return league.isOwner ? "Amministratore" : "Admin delegato";
}

/** Riquadro «Le tue leghe». Con `leagues` null mostra i segnaposto di caricamento. */
export function LeagueListCard({ leagues, error }: { leagues: LeagueSummary[] | null; error?: ReactNode }) {
  const seasons = [...new Set((leagues ?? []).map((league) => league.seasonCode))];
  return (
    <section className="card lg-card">
      <div className="lg-title">
        <h2>Le tue leghe</h2>
        {seasons.length === 1 ? <span>Stagione {seasons[0]}</span> : null}
      </div>
      {error}
      {leagues === null ? (
        <div className="stack" aria-busy="true" aria-label="Carico le tue leghe">
          <div className="skeleton lg-skeleton" />
          <div className="skeleton lg-skeleton" />
        </div>
      ) : leagues.length === 0 ? (
        error ? null : (
          <EmptyState title="Nessuna lega">
            Crea una lega nuova oppure entra con un codice invito. Chi apre il link di invito entra dopo l&apos;accesso, senza ridigitare il codice.
          </EmptyState>
        )
      ) : (
        <ul className="lg-list">
          {leagues.map((league) => (
            <li key={league.id}>
              <Link className="lg-row" href={`/leghe/${league.id}`}>
                <span className="lg-crest" aria-hidden="true">{league.name.trim().charAt(0).toUpperCase()}</span>
                <span className="lg-row-main">
                  <strong>{league.name}</strong>
                  <span className="lg-row-team">
                    <i data-manager={league.isManager}>{roleLabel(league)}</i>
                    {league.teamName ? ` · ${league.teamName}` : ""}
                    {seasons.length > 1 ? ` · ${league.seasonCode}` : ""}
                  </span>
                  {league.isManager ? <span className="lg-row-code">Codice <b>{league.joinCode}</b></span> : null}
                </span>
                <span className="lg-chevron" aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {leagues?.some((league) => league.isManager) ? <p className="lg-hint">Il codice invito non scade da solo.</p> : null}
      <Link className="lg-link" href="/albo">
        <span>Albo d&apos;oro <small>Le stagioni chiuse</small></span>
        <span className="lg-chevron" aria-hidden="true">›</span>
      </Link>
    </section>
  );
}

/** Quello che si vede appena si tocca «Leghe», mentre la pagina arriva dal server. */
export function LeaguesPreview() {
  const leagues = useMyLeagues();
  return (
    <div className="lg-layout" aria-busy="true">
      <LeagueListCard leagues={leagues} />
    </div>
  );
}
