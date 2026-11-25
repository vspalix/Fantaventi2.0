"use client";

import { useEffect, useState } from "react";
import { InfoTip } from "@/components/InfoTip";
import { CompactLineup, compactFromAudit } from "@/components/lineups/CompactLineup";
import type { ScoreAudit } from "@/lib/engine/score-audit";

export function MyPagelle({
  leagueId,
  gameweekId,
  gameweekNumber,
  fantasyTeamId,
}: {
  leagueId: string;
  gameweekId: string;
  gameweekNumber: number;
  fantasyTeamId: string;
}) {
  const [audit, setAudit] = useState<ScoreAudit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameweekId || !fantasyTeamId) return;
    let cancel = false;
    void (async () => {
      try {
        const response = await fetch(`/api/leagues/${leagueId}/matchday?gameweekId=${gameweekId}&fantasyTeamId=${fantasyTeamId}`);
        const body = await response.json() as ScoreAudit & { error?: string };
        if (cancel) return;
        if (!response.ok) throw new Error(body.error ?? "Voti non disponibili.");
        setAudit(body);
      } catch (reason) {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Voti non disponibili.");
      }
    })();
    return () => { cancel = true; };
  }, [leagueId, gameweekId, fantasyTeamId]);

  if (!gameweekId || !fantasyTeamId) return <p className="small muted">Nessuna giornata calcolata da mostrare.</p>;
  const rows = audit ? compactFromAudit(audit.players) : null;
  return (
    <section className="stack">
      <header className="page-head">
        <h1 className="section-title">Voti e pagelle</h1>
        <p className="small muted">Giornata {gameweekNumber} <InfoTip label="Voti e pagelle">Solo la tua squadra: titolari per ruolo, panchina nell&apos;ordine schierato e bonus di giornata.</InfoTip></p>
      </header>
      {error ? <p className="banner">{error}</p> : null}
      {rows ? (
        <article className="card">
          <CompactLineup
            starters={rows.starters}
            bench={rows.bench}
            bonuses={audit ? {
              captain: audit.modifiers.captain.points,
              fairPlay: audit.modifiers.fairPlay.points,
              defense: audit.modifiers.defense.modifier,
              defenseOn: audit.modifiers.defense.enabled,
            } : null}
          />
          <p className="small muted">Fantapunti {audit?.sum.total.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</p>
        </article>
      ) : error ? null : <p className="small muted">Carico i voti…</p>}
    </section>
  );
}
