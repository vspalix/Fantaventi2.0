"use client";

import { useEffect, useMemo, useState } from "react";
import { MatchdayBreakdown } from "@/components/scores/MatchdayBreakdown";
import type { ScoreAudit } from "@/lib/engine/score-audit";
import type { HubGameweek, LeagueParticipant } from "@/lib/types";

export function MatchdayResults({
  leagueId,
  gameweeks,
  teams,
  myTeamId,
  canExport = false,
}: {
  leagueId: string;
  gameweeks: HubGameweek[];
  teams: LeagueParticipant[];
  myTeamId: string | null;
  canExport?: boolean;
}) {
  const closed = useMemo(
    () => gameweeks.filter((week) => week.status === "scored" || week.status === "final").sort((left, right) => right.number - left.number),
    [gameweeks],
  );
  const [gameweekId, setGameweekId] = useState(closed[0]?.id ?? "");
  const [teamId, setTeamId] = useState(myTeamId && teams.some((team) => team.fantasyTeamId === myTeamId) ? myTeamId : teams[0]?.fantasyTeamId ?? "");
  const [detail, setDetail] = useState<ScoreAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(closed.length > 0 && teamId !== "");

  useEffect(() => {
    if (!gameweekId || !teamId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const url = `/api/leagues/${encodeURIComponent(leagueId)}/matchday?gameweekId=${encodeURIComponent(gameweekId)}&fantasyTeamId=${encodeURIComponent(teamId)}`;
      void fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "manual", signal: controller.signal })
        .then(async (response) => {
          if (controller.signal.aborted) return;
          if (response.type === "opaqueredirect" || response.status === 401) {
            throw new Error("La sessione non accompagna questa richiesta. Entra di nuovo.");
          }
          const body = (await response.json()) as ScoreAudit & { error?: string };
          if (!response.ok) throw new Error(body.error || "Dettaglio non disponibile.");
          setDetail(body);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setDetail(null);
          setError(cause instanceof Error ? cause.message : "Dettaglio non disponibile.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [leagueId, gameweekId, teamId]);

  if (closed.length === 0) {
    return (
      <section className="card stack">
        <h2>Risultati</h2>
        <p>Nessuna giornata è ancora calcolata. Qui compariranno voti, bonus, malus e modificatori quando una giornata viene chiusa.</p>
      </section>
    );
  }

  const selected = closed.find((week) => week.id === gameweekId) ?? closed[0];

  return (
    <section className="card stack">
      <h2>Risultati</h2>
      <p className="small muted">
        Giornata {selected?.number}. Voto, bonus, malus e somma dei modificatori, per la tua squadra e per le altre.
      </p>
      <div className="gw-row" role="tablist" aria-label="Giornate calcolate">
        {closed.map((week) => (
          <button
            key={week.id}
            className="gw-chip"
            type="button"
            data-active={week.id === selected?.id}
            onClick={() => setGameweekId(week.id)}
          >
            {week.number}
          </button>
        ))}
      </div>
      <div className="row">
        <label>
          Squadra
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => (
              <option key={team.fantasyTeamId} value={team.fantasyTeamId}>
                {team.teamName}{team.fantasyTeamId === myTeamId ? " · la tua" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? <p>Leggo voti e modificatori…</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {canExport ? (
        <button className="ghost" type="button" onClick={() => void downloadBlackBox(leagueId, selected?.id ?? "")}>
          Scarica la scatola nera della giornata
        </button>
      ) : null}
      {detail && !loading ? <MatchdayBreakdown audit={detail} onDownload={() => downloadAudit(detail)} /> : null}
    </section>
  );
}

function downloadAudit(audit: ScoreAudit) {
  const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `audit-giornata-${audit.gameweekNumber}-${audit.teamName.replace(/\s+/g, "-").toLowerCase()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function downloadBlackBox(leagueId: string, gameweekId: string) {
  const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/audit-export?gameweekId=${encodeURIComponent(gameweekId)}`);
  if (!response.ok) return;
  const body = await response.json();
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `scatola-nera-giornata-${body.teams?.[0]?.gameweekNumber ?? "lega"}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
