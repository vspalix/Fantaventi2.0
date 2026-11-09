"use client";

import { useEffect, useState } from "react";
import { MatchdayBreakdown } from "@/components/scores/MatchdayBreakdown";
import type { ScoreAudit } from "@/lib/engine/score-audit";

export function ScoreAuditDialog({
  leagueId,
  gameweekId,
  gameweekNumber,
  teams,
  initialTeamId,
  onClose,
}: {
  leagueId: string;
  gameweekId: string;
  gameweekNumber: number | null;
  teams: { id: string; name: string }[];
  initialTeamId: string;
  onClose: () => void;
}) {
  const [teamId, setTeamId] = useState(initialTeamId);
  const [audit, setAudit] = useState<ScoreAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const url = `/api/admin/score-audit?leagueId=${encodeURIComponent(leagueId)}&gameweekId=${encodeURIComponent(gameweekId)}&fantasyTeamId=${encodeURIComponent(teamId)}`;
      void fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "manual", signal: controller.signal })
        .then(async (response) => {
          if (controller.signal.aborted) return;
          if (response.type === "opaqueredirect" || response.status === 401) {
            throw new Error("La sessione non accompagna questa richiesta. Entra di nuovo.");
          }
          const body = (await response.json()) as ScoreAudit & { error?: string };
          if (!response.ok) throw new Error(body.error || "Audit non disponibile.");
          setAudit(body);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setAudit(null);
          setError(cause instanceof Error ? cause.message : "Audit non disponibile.");
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

  function download() {
    if (!audit) return;
    const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-giornata-${audit.gameweekNumber}-${audit.teamName.replace(/\s+/g, "-").toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal audit" role="dialog" aria-modal="true" aria-labelledby="audit-title" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="audit-title">Audit calcolo · giornata {gameweekNumber ?? audit?.gameweekNumber ?? "—"}</h2>
            <p className="small muted">
              {audit?.mode === "provisional"
                ? "Proiezione: fantavoto già pubblicato. La panchina entra solo se il titolare è ufficialmente senza voto."
                : "Ricalcolo ufficiale della giornata chiusa."}
            </p>
          </div>
          <button className="ghost" type="button" onClick={onClose}>Chiudi</button>
        </header>
        <label>
          Squadra
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        {loading ? <p>Leggo formazione, voti e modificatori…</p> : null}
        {error ? <p className="notice">{error}</p> : null}
        {audit && !loading ? <MatchdayBreakdown audit={audit} onDownload={download} /> : null}
      </div>
    </div>
  );
}

