"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { WheelPicker } from "@/components/lineups/WheelPicker";

export type SwitchLeague = { id: string; teamName: string; leagueName: string };

/** Fino a questo numero di leghe basta la tendina; oltre si sceglie con il rullo. */
const LIST_UP_TO = 7;

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

/**
 * Scelta della lega nella barra in alto: mostra quella in uso e, aperta, l'elenco
 * (tendina) o il rullo con la ricerca quando le leghe sono tante.
 */
export function LeagueSwitcher({
  leagues,
  currentId,
  open,
  switching,
  onToggle,
  onClose,
  onChoose,
}: {
  leagues: SwitchLeague[];
  currentId: string;
  open: boolean;
  /** La lega scelta si sta caricando: lo si mostra subito. */
  switching: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChoose: (leagueId: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const current = leagues.find((league) => league.id === currentId) ?? leagues[0];
  const wheel = leagues.length > LIST_UP_TO;

  useEffect(() => {
    // Il rullo gestisce da sé il tasto Esc.
    if (!open || wheel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      trigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, wheel, onClose]);

  const all = (
    <Link className="lsw-all" href="/leghe" onClick={onClose}>
      <span>Tutte le leghe, entra o crea</span>
      <span aria-hidden="true">›</span>
    </Link>
  );

  return (
    <div className="lsw">
      <button ref={trigger} className="lsw-trigger" type="button" aria-expanded={open} aria-haspopup="dialog" aria-busy={switching} onClick={onToggle}>
        <span className="lsw-trigger-text">
          <strong>{current.leagueName}</strong>
          <small>{current.teamName}</small>
        </span>
        {switching ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {open && wheel ? createPortal(
        <WheelPicker
          title="Le tue leghe"
          items={leagues.map((league) => ({ id: league.id, label: league.leagueName, sub: league.teamName }))}
          selectedId={current.id}
          search={`Cerca tra ${leagues.length} leghe`}
          emptyText="Nessuna lega con questo nome."
          confirmLabel="Apri"
          confirmOnActiveTap
          footer={all}
          onConfirm={onChoose}
          onClose={onClose}
        />,
        document.body,
      ) : null}
      {open && !wheel ? (
        <>
          <button className="lsw-backdrop" type="button" tabIndex={-1} aria-label="Chiudi l'elenco delle leghe" onClick={onClose} />
          <div className="lsw-panel" role="dialog" aria-label="Le tue leghe">
            <ul className="lsw-list">
              {leagues.map((league) => (
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
            {all}
          </div>
        </>
      ) : null}
      {switching ? (
        <div className="lsw-wait" role="status">
          <div className="lsw-wait-body">
            <p>Apro <strong>{current.leagueName}</strong></p>
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
