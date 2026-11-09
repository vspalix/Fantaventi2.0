"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LEAGUE_RULES } from "@/lib/league-rules";
import type { LeagueSummary } from "@/lib/types";

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Richiesta non riuscita.");
  return body;
}

export function LeagueOnboarding({ variant = "page" }: { variant?: "page" | "card" }) {
  const router = useRouter();
  const [step, setStep] = useState<"choose" | "create" | "join">("choose");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<LeagueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function createLeague() {
    setPending(true);
    setError(null);
    try {
      const body = await readJson<{ league: LeagueSummary }>(await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rules: DEFAULT_LEAGUE_RULES }),
      }));
      setCreated(body.league);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Creazione non riuscita.");
    } finally {
      setPending(false);
    }
  }

  async function joinLeague() {
    setPending(true);
    setError(null);
    try {
      const body = await readJson<{ league: LeagueSummary }>(await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }));
      router.push(`/leghe/${body.league.id}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Iscrizione non riuscita.");
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
            <button className="primary" type="submit" disabled={pending || name.trim().length < 2}>Crea una Lega</button>
            <button className="ghost" type="button" onClick={() => { setError(null); setStep("choose"); }}>Indietro</button>
          </div>
        </form>
      ) : null}
      {step === "join" ? (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); void joinLeague(); }}>
          <label>
            Codice
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="H7K2M9QA" autoFocus />
          </label>
          <div className="landing-actions">
            <button className="primary" type="submit" disabled={pending || code.trim().length < 4}>Unisciti con Codice</button>
            <button className="ghost" type="button" onClick={() => { setError(null); setStep("choose"); }}>Indietro</button>
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
