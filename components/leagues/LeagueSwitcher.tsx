"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type SwitchLeague = { id: string; teamName: string; leagueName: string };

/** Oltre questo numero di leghe compare la ricerca. */
const SEARCH_FROM = 7;

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

/**
 * Tendina in alto per saltare da una lega all'altra: mostra la lega in uso e, aperta,
 * l'elenco completo con la ricerca per nome della lega o della squadra.
 */
export function LeagueSwitcher({
  leagues,
  currentId,
  open,
  onToggle,
  onClose,
  onChoose,
}: {
  leagues: SwitchLeague[];
  currentId: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChoose: (leagueId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = leagues.find((league) => league.id === currentId) ?? leagues[0];
  const wanted = query.trim().toLocaleLowerCase("it");
  const shown = wanted
    ? leagues.filter((league) => `${league.leagueName} ${league.teamName}`.toLocaleLowerCase("it").includes(wanted))
    : leagues;

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    // La lega in uso è subito visibile, anche in fondo a un elenco lungo.
    const box = list.current;
    const active = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (box && active) box.scrollTop = active.offsetTop - (box.clientHeight - active.offsetHeight) / 2;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      trigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // onClose cambia a ogni disegno: qui conta solo l'apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="lsw">
      <button ref={trigger} className="lsw-trigger" type="button" aria-expanded={open} aria-haspopup="dialog" onClick={onToggle}>
        <span className="lsw-trigger-text">
          <strong>{current.leagueName}</strong>
          <small>{current.teamName}</small>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <>
          <button className="lsw-backdrop" type="button" tabIndex={-1} aria-label="Chiudi l'elenco delle leghe" onClick={onClose} />
          <div className="lsw-panel" role="dialog" aria-label="Le tue leghe">
            {leagues.length >= SEARCH_FROM ? (
              <input
                className="lsw-search"
                type="search"
                aria-label="Cerca una lega"
                placeholder={`Cerca tra ${leagues.length} leghe`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && shown.length > 0) onChoose(shown[0].id);
                }}
              />
            ) : null}
            <ul className="lsw-list" ref={list}>
              {shown.map((league) => (
                <li key={league.id}>
                  <button type="button" aria-current={league.id === current.id} onClick={() => onChoose(league.id)}>
                    <span className="lsw-crest" aria-hidden="true">{initialOf(league.leagueName)}</span>
                    <span className="lsw-row-text">
                      <strong>{league.leagueName}</strong>
                      <small>{league.teamName}</small>
                    </span>
                    {league.id === current.id ? <span className="lsw-check" aria-hidden="true">✓</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {shown.length === 0 ? <p className="lsw-empty">Nessuna lega con questo nome.</p> : null}
            <Link className="lsw-all" href="/leghe" onClick={onClose}>
              <span>Tutte le leghe, entra o crea</span>
              <span aria-hidden="true">›</span>
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
