"use client";

import Link from "next/link";
import { BusyLabel } from "@/components/BusyLabel";
import { CopyInviteLink } from "@/components/leagues/CopyInviteLink";
import { EmptyState } from "@/components/EmptyState";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BONUS_FIELDS, COMPETITION_FORMATS, DEFAULT_LEAGUE_RULES, defaultPhases, type CompetitionFormat, type LeagueRules } from "@/lib/league-rules";
import { pushToast } from "@/lib/toast";
import type { LeagueSummary } from "@/lib/types";
import { readAction } from "@/lib/feedback";

async function readJson<T>(response: Response): Promise<T> {
  return readAction<T>(response);
}

export function LeagueManager({ signedIn }: { signedIn: boolean; hostMode?: boolean }) {
  const router = useRouter();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [publicLeagues, setPublicLeagues] = useState<LeagueSummary[]>([]);
  const [name, setName] = useState("");
  const [step, setStep] = useState(0);
  const [rules, setRules] = useState<LeagueRules>(DEFAULT_LEAGUE_RULES);
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<(LeagueSummary & { rulesStored?: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/api/leagues")
      .then((response) => readJson<{ leagues: LeagueSummary[]; publicLeagues?: LeagueSummary[] }>(response))
      .then((body) => {
        if (!cancelled) {
          setLeagues(body.leagues);
          setPublicLeagues(body.publicLeagues ?? []);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function createLeague() {
    if (flight.current) return;
    flight.current = true;
    setPending(true);
    setError(null);
    try {
      const body = await readJson<{ league: LeagueSummary & { rulesStored?: boolean } }>(await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rules }),
      }));
      setCreated(body.league);
      setLeagues((current) => [body.league, ...current.filter((league) => league.id !== body.league.id)]);
      setName("");
      pushToast("ok", "Lega creata. Condividi il codice invito.");
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "Creazione non riuscita.";
      setError(text);
      pushToast("err", text);
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  async function joinLeague() {
    if (flight.current) return;
    flight.current = true;
    setPending(true);
    setError(null);
    try {
      const body = await readJson<{ league: LeagueSummary }>(await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }));
      router.push(`/leghe/${body.league.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Iscrizione non riuscita.");
      flight.current = false;
      setPending(false);
    }
  }

  if (!signedIn) {
    return (
      <section className="card">
        <h2>Entra per gestire le leghe</h2>
        <p>Il codice invito è legato al tuo account e alla squadra della stagione.</p>
        <Link className="primary" href="/accesso">Vai all&apos;accesso</Link>
      </section>
    );
  }

  return (
    <div className="stack">
      {error ? <p className="banner">{error}</p> : null}
      {created ? (
        <section className="card">
          <h2>Lega creata</h2>
          <p>Condividi questo codice. Chi ha già una rosa può entrare subito.</p>
          {created.rulesStored === false ? (
            <p className="banner">Le regole non sono state salvate. Esegui league_settings.sql e ricrea la lega.</p>
          ) : null}
          <div className="code">{created.joinCode}</div>
          <div className="row" style={{ marginTop: 12 }}>
            <CopyInviteLink code={created.joinCode} />
            <Link className="primary" href={`/leghe/${created.id}`}>Apri amministrazione</Link>
          </div>
        </section>
      ) : null}
      <div className="grid-2">
        <form className="card stack" onSubmit={(event) => { event.preventDefault(); void createLeague(); }}>
          <h2>Crea una lega</h2>
          <p>Passo {step + 1} di 4. Le regole restano sulla lega e il calcolo le legge da lì.</p>
          {step === 0 ? (
            <>
              <label>
                Nome
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Lega degli uffici" />
              </label>
              <label>
                Formato
                <select
                  value={rules.format}
                  onChange={(event) => {
                    const format = event.target.value as CompetitionFormat;
                    setRules({
                      ...rules,
                      format,
                      ranking: format === "h2h" ? "head_to_head" : "sum",
                      phases: defaultPhases(format),
                    });
                  }}
                >
                  {COMPETITION_FORMATS.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <p className="small muted">{COMPETITION_FORMATS.find((item) => item.id === rules.format)?.detail}</p>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={rules.defenseEnabled}
                  onChange={(event) => setRules({ ...rules, defenseEnabled: event.target.checked })}
                />
                {" "}Modificatore difesa
              </label>
              {BONUS_FIELDS.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    type="number"
                    step="0.5"
                    value={rules.bonusMalus[field.key]}
                    onChange={(event) => setRules({
                      ...rules,
                      bonusMalus: { ...rules.bonusMalus, [field.key]: Number(event.target.value) },
                    })}
                  />
                </label>
              ))}
            </>
          ) : null}
          {step === 2 ? (
            <>
              <label>
                Visibilità
                <select
                  value={rules.visibility}
                  onChange={(event) => setRules({ ...rules, visibility: event.target.value as LeagueRules["visibility"] })}
                >
                  <option value="private">Privata, con codice invito</option>
                  <option value="public">Pubblica</option>
                </select>
              </label>
              <label>
                Iscrizioni
                <select
                  value={rules.enrollment}
                  onChange={(event) => setRules({
                    ...rules,
                    enrollment: event.target.value as LeagueRules["enrollment"],
                    maxMembers: event.target.value === "closed" ? (rules.maxMembers ?? 8) : null,
                  })}
                >
                  <option value="open">Aperta, con ingresso in media</option>
                  <option value="closed">Numero chiuso</option>
                </select>
              </label>
              {rules.enrollment === "closed" ? (
                <label>
                  Slot
                  <input
                    type="number"
                    min={2}
                    value={rules.maxMembers ?? 8}
                    onChange={(event) => setRules({ ...rules, maxMembers: Number(event.target.value) })}
                  />
                </label>
              ) : null}
            </>
          ) : null}
          {step === 3 ? (
            <>
              <p className="small muted">La rosa non usa crediti. Vale un calciatore per club e i limiti di ruolo del listone.</p>
              <label className="row">
                <input
                  type="checkbox"
                  checked={rules.exclusiveRosters}
                  onChange={(event) => setRules({ ...rules, exclusiveRosters: event.target.checked })}
                />
                Rose esclusive: un calciatore non può stare in due squadre di questa lega
              </label>
              <label>
                Partite rinviate
                <select
                  value={rules.postponement}
                  onChange={(event) => setRules({ ...rules, postponement: event.target.value as LeagueRules["postponement"] })}
                >
                  <option value="wait_recovery">Attendi il recupero reale</option>
                  <option value="political_six">Assegna 6 politico</option>
                </select>
              </label>
            </>
          ) : null}
          <div className="row">
            {step > 0 ? (
              <button className="ghost" type="button" onClick={() => setStep(step - 1)}>Indietro</button>
            ) : null}
            {step < 3 ? (
              <button className="primary" type="button" disabled={step === 0 && name.trim().length < 2} onClick={() => setStep(step + 1)}>
                Avanti
              </button>
            ) : (
              <button className="primary" type="submit" disabled={pending || name.trim().length < 2} aria-busy={pending}>
                <BusyLabel pending={pending} idle="Crea lega" busy="Creazione..." />
              </button>
            )}
          </div>
        </form>
        <form className="card stack" onSubmit={(event) => { event.preventDefault(); void joinLeague(); }}>
          <h2>Unisciti con un codice</h2>
          <p>Serve una rosa già salvata: la lega iscrive la squadra, non solo l&apos;utente.</p>
          <label>
            Codice invito
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="H7K2M9QA" />
          </label>
          <button className="primary" type="submit" disabled={pending || code.trim().length < 4} aria-busy={pending}>
            <BusyLabel pending={pending} idle="Entra nella lega" busy="Iscrizione..." />
          </button>
        </form>
      </div>
      {publicLeagues.length > 0 ? (
        <section className="card">
          <h2>Leghe pubbliche</h2>
          <ul className="list">
            {publicLeagues.map((league) => (
              <li key={league.id}>
                <span className="player-main">
                  <strong>{league.name}</strong>
                  <span className="small muted">{league.seasonCode}</span>
                </span>
                <button
                  className="primary"
                  type="button"
                  disabled={pending}
                  aria-busy={pending}
                  onClick={() => {
                    if (flight.current) return;
                    flight.current = true;
                    setPending(true);
                    setError(null);
                    void fetch("/api/leagues/join", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ leagueId: league.id }),
                    })
                      .then((response) => readJson<{ league: LeagueSummary }>(response))
                      .then((body) => router.push(`/leghe/${body.league.id}`))
                      .catch((reason: unknown) => {
                        setError(reason instanceof Error ? reason.message : "Iscrizione non riuscita.");
                        flight.current = false;
                        setPending(false);
                      });
                  }}
                >
                  <BusyLabel pending={pending} idle="Entra" busy="Iscrizione..." />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="card">
        <h2>Le tue leghe</h2>
        {leagues.length === 0 ? (
          <EmptyState title="Nessuna lega">
            Crea una lega nuova oppure entra con un codice invito. Chi apre il link di invito entra dopo l&apos;accesso, senza ridigitare il codice.
          </EmptyState>
        ) : (
          <ul className="list">
            {leagues.map((league) => (
              <li key={league.id}>
                <Link href={`/leghe/${league.id}`}>
                  <span className="player-main">
                    <strong>{league.name}</strong>
                    <span className="small muted">{league.isManager ? `${league.isOwner ? "Amministratore" : "Admin delegato"} · ` : ""}{league.seasonCode}</span>
                  </span>
                  <span className="code" style={{ fontSize: 14 }}>{league.isManager ? league.joinCode : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
