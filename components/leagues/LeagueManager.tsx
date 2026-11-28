"use client";

import Link from "next/link";
import { BusyLabel } from "@/components/BusyLabel";
import { CopyInviteLink } from "@/components/leagues/CopyInviteLink";
import { CreateLeagueForm, type NewLeague, type SeasonCalendar } from "@/components/leagues/CreateLeagueForm";
import { JoinImportPrompt } from "@/components/leagues/JoinImportPrompt";
import { LeagueListCard } from "@/components/leagues/LeagueListCard";
import { useMyLeagues } from "@/components/leagues/MyLeagues";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pushToast } from "@/lib/toast";
import type { LeagueSummary, RosterImportSource } from "@/lib/types";
import { readAction, readableError } from "@/lib/feedback";

async function readJson<T>(response: Response): Promise<T> {
  return readAction<T>(response);
}

/** Dove mostrare un errore: vicino a ciò che l'ha provocato. */
type Place = "list" | "add" | "public";

export function LeagueManager({ signedIn, startCreating = false }: { signedIn: boolean; startCreating?: boolean }) {
  const router = useRouter();
  // L'elenco già letto all'apertura dell'app si vede subito; poi viene aggiornato in sottofondo.
  const known = useMyLeagues();
  /** null finché l'elenco non è arrivato. */
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(known);
  const [publicLeagues, setPublicLeagues] = useState<LeagueSummary[]>([]);
  /** Da dove riprendere l'elenco pubblico; null quando è finito. */
  const [publicNext, setPublicNext] = useState<number | null>(null);
  const [publicQuery, setPublicQuery] = useState("");
  const [publicBusy, setPublicBusy] = useState(false);
  /** La ricerca che l'elenco a video sta mostrando. */
  const publicAsked = useRef("");
  const [calendar, setCalendar] = useState<SeasonCalendar | null>(null);
  const [mode, setMode] = useState<"join" | "create">(startCreating ? "create" : "join");
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<(LeagueSummary & { rulesStored?: boolean }) | null>(null);
  const [offer, setOffer] = useState<{ targetName: string; sources: RosterImportSource[]; payload: { code?: string; leagueId?: string } } | null>(null);
  const [error, setError] = useState<{ place: Place; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const flight = useRef(false);
  const createdCard = useRef<HTMLElement>(null);
  const addCard = useRef<HTMLElement>(null);
  const shownForm = useRef(false);

  // Chi arriva per creare una lega vede subito il modulo, una volta che l'elenco sopra ha preso il suo posto.
  const listed = calendar !== null;
  useEffect(() => {
    if (!startCreating || !listed || shownForm.current) return;
    shownForm.current = true;
    addCard.current?.scrollIntoView({ block: "start" });
  }, [startCreating, listed]);

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
      .then((response) => readJson<{ leagues: LeagueSummary[]; publicLeagues?: LeagueSummary[]; publicNext?: number | null; calendar?: SeasonCalendar }>(response))
      .then((body) => {
        if (!cancelled) {
          setLeagues(body.leagues);
          setPublicLeagues(body.publicLeagues ?? []);
          setPublicNext(body.publicNext ?? null);
          setCalendar(body.calendar ?? null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLeagues((current) => current ?? []);
          setError({ place: "list", text: readableError(reason, "Elenco delle leghe non disponibile.") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function loadPublic(search: string, offset: number) {
    publicAsked.current = search;
    setPublicBusy(true);
    try {
      const query = new URLSearchParams({ q: search, offset: String(offset) });
      const body = await readJson<{ publicLeagues: LeagueSummary[]; publicNext: number | null }>(await fetch(`/api/leagues?${query}`));
      // Una ricerca più recente ha già preso il posto di questa.
      if (publicAsked.current !== search) return;
      setPublicLeagues((current) => (offset === 0 ? body.publicLeagues : [...current, ...body.publicLeagues]));
      setPublicNext(body.publicNext);
    } catch (reason) {
      setError({ place: "public", text: readableError(reason, "Leghe pubbliche non disponibili.") });
    } finally {
      if (publicAsked.current === search) setPublicBusy(false);
    }
  }

  // Si cerca poco dopo l'ultima lettera, non a ogni tasto.
  useEffect(() => {
    const search = publicQuery.trim();
    if (search === publicAsked.current) return;
    const timer = window.setTimeout(() => void loadPublic(search, 0), 350);
    return () => window.clearTimeout(timer);
    // loadPublic cambia a ogni disegno: conta solo il testo cercato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicQuery]);

  async function createLeague(league: NewLeague) {
    if (flight.current) return false;
    flight.current = true;
    setPending(true);
    setError(null);
    try {
      const body = await readJson<{ league: LeagueSummary & { rulesStored?: boolean } }>(await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(league),
      }));
      setCreated(body.league);
      setLeagues((current) => [body.league, ...(current ?? []).filter((league) => league.id !== body.league.id)]);
      pushToast("ok", "Lega creata. Condividi il codice invito.");
      // La tendina in alto deve conoscere subito la lega nuova.
      router.refresh();
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
      router.refresh();
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

  const errorAt = (place: Place) => (error?.place === place ? <p className="banner" role="alert">{error.text}</p> : null);

  return (
    <div className="lg-layout">
      <LeagueListCard leagues={leagues} error={errorAt("list")} />

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

        <section className="card stack lg-card lg-add" ref={addCard}>
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
            <CreateLeagueForm pending={pending} calendar={calendar} onCreate={createLeague} />
          </div>
        </section>

        {publicLeagues.length > 0 || publicNext !== null || publicQuery.trim() ? (
          <section className="card lg-card">
            <h2>Leghe pubbliche</h2>
            {offer ? null : errorAt("public")}
            <input type="search" aria-label="Cerca una lega pubblica" placeholder="Cerca per nome" value={publicQuery} onChange={(event) => setPublicQuery(event.target.value)} />
            {publicLeagues.length === 0 ? <p className="lg-hint">{publicBusy ? "Cerco..." : "Nessuna lega pubblica con questo nome."}</p> : null}
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
            {publicNext !== null ? (
              <button className="ghost" type="button" disabled={publicBusy} aria-busy={publicBusy} onClick={() => void loadPublic(publicAsked.current, publicNext)}>
                <BusyLabel pending={publicBusy} idle="Mostra altre leghe" busy="Carico..." />
              </button>
            ) : null}
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
