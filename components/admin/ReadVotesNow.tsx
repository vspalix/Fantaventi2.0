"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Azione rapida della panoramica: stesso giro del pulsante in «Giornata in corso»
// (calendario, lettura dei voti, ricalcolo provvisorio). Chiede conferma.
export function ReadVotesNow() {
  const router = useRouter();
  const flight = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (flight.current) return;
    if (!window.confirm("Leggo adesso calendario e voti e ricalcolo i punteggi provvisori. Procedo?")) return;
    flight.current = true;
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/live-status", { method: "POST" });
      const body = (await response.json()) as {
        error?: string;
        gameweekNumber?: number | null;
        calendarError?: string | null;
        votes?: { synced: unknown[]; errors: { message: string }[] };
        score?: { teams?: number; skipped?: boolean; reason?: string } | null;
      };
      if (!response.ok) throw new Error(body.error ?? "Lettura non riuscita.");
      const problems = [
        body.calendarError,
        ...(body.votes?.errors ?? []).map((item) => item.message),
        body.score?.skipped ? body.score.reason : null,
      ].filter(Boolean);
      setMessage(problems.length > 0
        ? `Giornata ${body.gameweekNumber ?? "—"}: ${problems.join(" ")}`
        : `Giornata ${body.gameweekNumber ?? "—"} aggiornata: ${body.votes?.synced.length ?? 0} letture, ${body.score?.teams ?? 0} squadre calcolate.`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lettura non riuscita.");
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="sa-btn sa-btn-gold" onClick={run} disabled={pending}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
        {pending ? "Lettura in corso…" : "Leggi i voti adesso"}
      </button>
      {message ? <p className="sa-note sa-note-ok" role="status">{message}</p> : null}
      {error ? <p className="sa-note sa-note-bad" role="alert">{error}</p> : null}
    </>
  );
}
