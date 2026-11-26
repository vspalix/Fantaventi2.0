"use client";

import { useRef, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { useRouter } from "next/navigation";
import { CopyInviteLink } from "@/components/leagues/CopyInviteLink";
import { JoinImportPrompt } from "@/components/leagues/JoinImportPrompt";
import { DEFAULT_LEAGUE_RULES } from "@/lib/league-rules";
import { pushToast } from "@/lib/toast";
import type { LeagueSummary, RosterImportSource } from "@/lib/types";
import { readAction, readableError } from "@/lib/feedback";

async function readJson<T>(response: Response): Promise<T> {
  return readAction<T>(response);
}

export function LeagueOnboarding({ variant = "page" }: { variant?: "page" | "card" }) {
  const router = useRouter();
  const [step, setStep] = useState<"choose" | "create" | "join">("choose");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<LeagueSummary | null>(null);
  const [offer, setOffer] = useState<{ targetName: string; sources: RosterImportSource[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);

  async function createLeague() {
    if (flight.current) return;
    flight.current = true;
    setPending(true);
    setError(null);
    try {
      const body = await readJson<{ league: LeagueSummary }>(await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rules: DEFAULT_LEAGUE_RULES }),
      }));
      setCreated(body.league);
      pushToast("ok", "Lega creata. Condividi il codice invito.");
      router.refresh();
    } catch (reason) {
      const text = readableError(reason, "Creazione non riuscita.");
      setError(text);
      pushToast("err", text);
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

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
          <button className="primary" type="button" onClick={() => { setError(null); setStep("create"); }}>
            Crea una Lega
          </button>
          <button className="primary" type="button" onClick={() => { setError(null); setStep("join"); }}>
            Unisciti con Codice
          </button>
        </div>
      ) : null}
      {step === "create" ? (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); void createLeague(); }}>
          <label>
            Nome
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Lega degli uffici" autoFocus />
          </label>
          <div className="landing-actions">
            <button className="primary" type="submit" disabled={pending || name.trim().length < 2} aria-busy={pending}>
              <BusyLabel pending={pending} idle="Crea una Lega" busy="Creazione..." />
            </button>
            <button className="ghost" type="button" onClick={() => { setError(null); setStep("choose"); }}>Indietro</button>
          </div>
        </form>
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

  const ready = created ? (
    <>
      <p>Condividi il codice con chi deve entrare.</p>
      <p className="code">{created.joinCode}</p>
      <div className="landing-actions">
        <CopyInviteLink code={created.joinCode} />
        <button className="primary" type="button" onClick={() => router.push(`/leghe/${created.id}`)}>
          Apri la lega
        </button>
      </div>
    </>
  ) : null;

  if (variant === "card") {
    return (
      <article className="card">
        <h2>{created ? "Lega pronta" : "Un'altra lega"}</h2>
        {created ? ready : (
          <>
            <p>Puoi averne più di una: creane una nuova oppure entra con un codice.</p>
            {actions}
          </>
        )}
      </article>
    );
  }

  if (created) {
    return (
      <section className="hero">
        <h1>Lega pronta</h1>
        {ready}
      </section>
    );
  }

  return (
    <section className="hero">
      <h1>La tua lega</h1>
      <p className="lede">Crea la competizione oppure entra con un codice.</p>
      {actions}
    </section>
  );
}
