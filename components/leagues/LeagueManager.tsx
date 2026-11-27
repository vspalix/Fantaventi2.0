"use client";

import Link from "next/link";
import { BusyLabel } from "@/components/BusyLabel";
import { CopyInviteLink } from "@/components/leagues/CopyInviteLink";
import { CreateLeagueForm } from "@/components/leagues/CreateLeagueForm";
import { JoinImportPrompt } from "@/components/leagues/JoinImportPrompt";
import { EmptyState } from "@/components/EmptyState";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LeagueRules } from "@/lib/league-rules";
import { pushToast } from "@/lib/toast";
import type { LeagueSummary, RosterImportSource } from "@/lib/types";
import { readAction, readableError } from "@/lib/feedback";

async function readJson<T>(response: Response): Promise<T> {
  return readAction<T>(response);
}

/** Dove mostrare un errore: vicino a ciò che l'ha provocato. */
type Place = "list" | "add" | "public";

function roleLabel(league: LeagueSummary) {
  if (!league.isManager) return "Giocatore";
  return league.isOwner ? "Amministratore" : "Admin delegato";
}

export function LeagueManager({ signedIn }: { signedIn: boolean; hostMode?: boolean }) {
  const router = useRouter();
  /** null finché l'elenco non è arrivato. */
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null);
  const [publicLeagues, setPublicLeagues] = useState<LeagueSummary[]>([]);
  const [mode, setMode] = useState<"join" | "create">("join");
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<(LeagueSummary & { rulesStored?: boolean }) | null>(null);
  const [offer, setOffer] = useState<{ targetName: string; sources: RosterImportSource[]; payload: { code?: string; leagueId?: string } } | null>(null);
  const [error, setError] = useState<{ place: Place; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);
  const createdCard = useRef<HTMLElement>(null);

  useEffect(() => {
    if (created) createdCard.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [created]);

  useEffect(() => {
    if (!offer || pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOffer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offer, pending]);

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
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLeagues([]);
          setError({ place: "list", text: readableError(reason, "Elenco delle leghe non disponibile.") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function createLeague(name: string, rules: LeagueRules) {
    if (flight.current) return false;
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
      setLeagues((current) => [body.league, ...(current ?? []).filter((league) => league.id !== body.league.id)]);
      pushToast("ok", "Lega creata. Condividi il codice invito.");
      return true;
    } catch (reason) {
      const text = readableError(reason, "Creazione non riuscita.");
      setError({ place: "add", text });
      pushToast("err", text);
      return false;
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  async function submitJoin(payload: { code?: string; leagueId?: string }, importFromLeagueId?: string | null, confirmed = false) {
    if (flight.current) return;
    flight.current = true;
    setPending(true);
    setError(null);
    try {
      const body = await readJson<{ league?: LeagueSummary; needsImport?: boolean; targetName?: string; sources?: RosterImportSource[] }>(await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, confirmed, importFromLeagueId }),
      }));
      if (body.needsImport && body.targetName && body.sources) {
        setOffer({ targetName: body.targetName, sources: body.sources, payload });
        return;
      }
      if (!body.league) throw new Error("Iscrizione non riuscita.");
      setOffer(null);
      router.push(`/leghe/${body.league.id}`);
    } catch (reason) {
      const text = readableError(reason, "Iscrizione non riuscita.");
      setError({ place: payload.leagueId ? "public" : "add", text });
      pushToast("err", text);
    } finally {
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

  const seasons = [...new Set((leagues ?? []).map((league) => league.seasonCode))];
  const errorAt = (place: Place) => (error?.place === place ? <p className="banner" role="alert">{error.text}</p> : null);

  return (
    <div className="lg-layout">
      <section className="card lg-card">
        <div className="lg-title">
          <h2>Le tue leghe</h2>
          {seasons.length === 1 ? <span>Stagione {seasons[0]}</span> : null}
        </div>
        {errorAt("list")}
        {leagues === null ? (
          <div className="stack" aria-busy="true" aria-label="Carico le tue leghe">
            <div className="skeleton lg-skeleton" />
            <div className="skeleton lg-skeleton" />
          </div>
        ) : leagues.length === 0 ? (
          error?.place === "list" ? null : (
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

      <div className="stack">
        {created ? (
          <section className="card stack lg-created" ref={createdCard}>
            <h2>Lega creata</h2>
            <p>Condividi questo codice. Chi ha già una rosa può entrare subito.</p>
            {created.rulesStored === false ? (
              <p className="banner">Le regole non sono state salvate. Esegui league_settings.sql e ricrea la lega.</p>
            ) : null}
            <div className="code lg-code">{created.joinCode}</div>
            <CopyInviteLink code={created.joinCode} />
            <Link className="ghost" href={`/leghe/${created.id}`}>Apri amministrazione</Link>
          </section>
        ) : null}

        <section className="card stack lg-card">
          <h2>Aggiungi una lega</h2>
          <div className="lg-seg" role="group" aria-label="Come aggiungere una lega">
            <button type="button" aria-pressed={mode === "join"} onClick={() => setMode("join")}>Ho un codice</button>
            <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>Creo una lega</button>
          </div>
          {offer ? null : errorAt("add")}
          {/* Restano tutti e due montati: passando da uno all'altro non si perde ciò che si è scritto. */}
          <div hidden={mode !== "join"}>
            <form className="stack" onSubmit={(event) => { event.preventDefault(); void submitJoin({ code }); }}>
              <label>
                Codice invito
                <input
                  className="lg-code-input"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="H7K2M9QA"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button className="primary" type="submit" disabled={pending || code.trim().length < 4} aria-busy={pending}>
                <BusyLabel pending={pending} idle="Entra nella lega" busy="Iscrizione..." />
              </button>
              <p className="lg-hint">Se hai già una rosa in un&apos;altra lega, prima di entrare ti chiedo se portarla.</p>
            </form>
          </div>
          <div hidden={mode !== "create"}>
            <CreateLeagueForm pending={pending} onCreate={createLeague} />
          </div>
        </section>

        {publicLeagues.length > 0 ? (
          <section className="card lg-card">
            <h2>Leghe pubbliche</h2>
            {offer ? null : errorAt("public")}
            <ul className="lg-list">
              {publicLeagues.map((league) => (
                <li key={league.id} className="lg-row">
                  <span className="lg-crest" aria-hidden="true">{league.name.trim().charAt(0).toUpperCase()}</span>
                  <span className="lg-row-main">
                    <strong>{league.name}</strong>
                    <span className="lg-row-team">{league.seasonCode}</span>
                  </span>
                  <button
                    className="ghost"
                    type="button"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => void submitJoin({ leagueId: league.id })}
                  >
                    <BusyLabel pending={pending} idle="Entra" busy="Iscrizione..." />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {offer ? (
        <div className="modal-backdrop lg-backdrop" role="presentation" onClick={() => { if (!pending) setOffer(null); }}>
          <div className="lg-offer" role="dialog" aria-modal="true" aria-label="Porti una rosa?" onClick={(event) => event.stopPropagation()}>
            {error ? <p className="banner" role="alert">{error.text}</p> : null}
            <JoinImportPrompt
              targetName={offer.targetName}
              sources={offer.sources}
              pending={pending}
              onPick={(importFromLeagueId) => void submitJoin(offer.payload, importFromLeagueId, true)}
            />
            <button className="ghost" type="button" disabled={pending} onClick={() => setOffer(null)}>Annulla</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
