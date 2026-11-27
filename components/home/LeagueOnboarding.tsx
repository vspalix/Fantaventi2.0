"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BusyLabel } from "@/components/BusyLabel";
import { useRouter } from "next/navigation";
import { JoinImportPrompt } from "@/components/leagues/JoinImportPrompt";
import type { LeagueSummary, RosterImportSource } from "@/lib/types";
import { readAction, readableError } from "@/lib/feedback";

async function readJson<T>(response: Response): Promise<T> {
  return readAction<T>(response);
}

/** Dalla Home: per creare si passa dal modulo completo delle Leghe, per entrare basta il codice. */
export function LeagueOnboarding() {
  const router = useRouter();
  const [step, setStep] = useState<"choose" | "join">("choose");
  const [code, setCode] = useState("");
  const [offer, setOffer] = useState<{ targetName: string; sources: RosterImportSource[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);

  async function joinLeague(importFromLeagueId?: string | null, confirmed = false) {
    if (flight.current) return;
    flight.current = true;
    setPending(true);
    setError(null);
    try {
      const body = await readJson<{ league?: LeagueSummary; needsImport?: boolean; targetName?: string; sources?: RosterImportSource[] }>(await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, confirmed, importFromLeagueId }),
      }));
      if (body.needsImport && body.targetName && body.sources) {
        setOffer({ targetName: body.targetName, sources: body.sources });
        return;
      }
      if (!body.league) throw new Error("Iscrizione non riuscita.");
      router.push(`/leghe/${body.league.id}`);
      router.refresh();
    } catch (reason) {
      setError(readableError(reason, "Iscrizione non riuscita."));
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  const actions = (
    <>
      {error ? <p className="banner">{error}</p> : null}
      {step === "choose" ? (
        <div className="landing-actions">
          <Link className="primary" href="/leghe?nuova=1">
            Crea una Lega
          </Link>
          <button className="primary" type="button" onClick={() => { setError(null); setStep("join"); }}>
            Unisciti con Codice
          </button>
        </div>
      ) : null}
      {step === "join" && offer ? (
        <>
          <JoinImportPrompt
            targetName={offer.targetName}
            sources={offer.sources}
            pending={pending}
            onPick={(importFromLeagueId) => void joinLeague(importFromLeagueId, true)}
          />
          <button className="ghost" type="button" onClick={() => { setOffer(null); setError(null); }}>Indietro</button>
        </>
      ) : null}
      {step === "join" && !offer ? (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); void joinLeague(); }}>
          <label>
            Codice
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="H7K2M9QA" autoFocus />
          </label>
          <div className="landing-actions">
            <button className="primary" type="submit" disabled={pending || code.trim().length < 4} aria-busy={pending}>
              <BusyLabel pending={pending} idle="Unisciti con Codice" busy="Iscrizione..." />
            </button>
            <button className="ghost" type="button" onClick={() => { setError(null); setOffer(null); setStep("choose"); }}>Indietro</button>
          </div>
        </form>
      ) : null}
    </>
  );

  return (
    <article className="card">
      <h2>Un&apos;altra lega</h2>
      <p>Puoi averne più di una: creane una nuova oppure entra con un codice.</p>
      {actions}
    </article>
  );
}
