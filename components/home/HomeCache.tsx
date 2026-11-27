"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import type { HomeBoard } from "@/lib/server/home-board";

/** Oltre questa età una Dashboard tenuta in memoria non si mostra più. */
const KEEP_MS = 10 * 60 * 1000;
/** Sotto questa età non si chiede di nuovo al server. */
const FRESH_MS = 60 * 1000;
/** Se la schermata vera non arriva, si smette di coprirla (così si vede l'eventuale errore). */
const GIVE_UP_MS = 8000;

type Pending = { leagueId: string; name: string; from: string };

type HomeCacheApi = {
  /** La lega scelta di cui si sta aspettando la schermata aggiornata. */
  pending: Pending | null;
  begin: (leagueId: string, name: string) => void;
  prefetch: (leagueId: string) => Promise<void>;
  arrived: (board: HomeBoard) => void;
  cached: (leagueId: string) => HomeBoard | null;
};

const HomeCacheContext = createContext<HomeCacheApi | null>(null);

export function useHomeCache() {
  const value = useContext(HomeCacheContext);
  if (!value) throw new Error("Manca HomeCacheProvider.");
  return value;
}

/**
 * Tiene sul dispositivo le Dashboard delle leghe, così il cambio lega le mostra
 * subito e intanto arriva quella aggiornata. Solo memoria: si svuota chiudendo l'app
 * e quando cambia l'utente.
 */
export function HomeCacheProvider({ owner, children }: { owner: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const boards = useRef(new Map<string, { board: HomeBoard; at: number }>());
  const loading = useRef(new Map<string, Promise<void>>());
  const generation = useRef(0);
  const [pending, setPending] = useState<Pending | null>(null);
  /** Cambia quando arriva una Dashboard: chi la sta aspettando si ridisegna. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const keptBoards = boards.current;
    const keptLoading = loading.current;
    return () => {
      generation.current += 1;
      keptBoards.clear();
      keptLoading.clear();
    };
  }, [owner]);

  const keep = useCallback((leagueId: string, board: HomeBoard) => {
    boards.current.set(leagueId, { board, at: Date.now() });
    setVersion((current) => current + 1);
  }, []);

  const prefetch = useCallback((leagueId: string) => {
    const kept = boards.current.get(leagueId);
    if (kept && Date.now() - kept.at < FRESH_MS) return Promise.resolve();
    const running = loading.current.get(leagueId);
    if (running) return running;
    const born = generation.current;
    const job = fetch(`/api/home-board?league=${encodeURIComponent(leagueId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { board: HomeBoard };
        if (born === generation.current) keep(leagueId, body.board);
      })
      // È solo un anticipo: se non riesce, al cambio la Dashboard arriva dalla pagina,
      // e i guasti del server vengono già segnalati dall'API.
      .catch(() => undefined)
      .finally(() => loading.current.delete(leagueId));
    loading.current.set(leagueId, job);
    return job;
  }, [keep]);

  const begin = useCallback((leagueId: string, name: string) => {
    setPending({ leagueId, name, from: window.location.pathname });
  }, []);

  const arrived = useCallback((board: HomeBoard) => {
    const leagueId = board.focus?.id;
    if (!leagueId) return;
    keep(leagueId, board);
    setPending((current) => (current?.leagueId === leagueId ? null : current));
  }, [keep]);

  const cached = useCallback((leagueId: string) => {
    const kept = boards.current.get(leagueId);
    return kept && Date.now() - kept.at < KEEP_MS ? kept.board : null;
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(null), GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  // Se intanto si va altrove, la schermata scelta non va più mostrata.
  useEffect(() => {
    setPending((current) => (current && pathname !== "/" && pathname !== current.from ? null : current));
  }, [pathname]);

  const value = useMemo(
    () => ({ pending, begin, prefetch, arrived, cached }),
    // `version` serve a ridisegnare quando arriva una Dashboard nuova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, begin, prefetch, arrived, cached, version],
  );

  return <HomeCacheContext.Provider value={value}>{children}</HomeCacheContext.Provider>;
}

/** La pagina Dashboard consegna qui ciò che ha ricevuto dal server. */
export function RememberBoard({ board }: { board: HomeBoard }) {
  const { arrived } = useHomeCache();
  useEffect(() => {
    arrived(board);
  }, [arrived, board]);
  return null;
}

/**
 * Contenuto della pagina. Durante un cambio lega mostra subito la Dashboard tenuta
 * in memoria (o i segnaposto), finché non arriva quella nuova.
 */
export function SwitchStage({ children }: { children: ReactNode }) {
  const { pending, cached } = useHomeCache();
  const board = pending ? cached(pending.leagueId) : null;
  return (
    <>
      {pending && board ? <HomeDashboard key={pending.leagueId} board={board} /> : null}
      {pending && !board ? (
        <div className="stack page-loading" role="status">
          <p className="stage-title">Apro <strong>{pending.name}</strong></p>
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : null}
      {/* La pagina resta montata (nascosta): è lei ad avvisare quando i dati nuovi arrivano. */}
      <div className={pending ? "stage-hidden" : "stage"}>{children}</div>
    </>
  );
}
