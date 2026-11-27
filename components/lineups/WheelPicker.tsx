"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PlayerRole } from "@/lib/types";

/** `role` mostra il bollino del ruolo; senza, compare l'iniziale. `sub` è la seconda riga. */
export type WheelItem = { id: string; label: string; role?: PlayerRole; detail?: string; sub?: string };

const ROW = 48;
const VISIBLE = 5;
const ROLE_LETTER: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };

/**
 * Scelta a rullo dal basso: si scorre con il dito, la riga al centro è quella scelta.
 * Si conferma con il pulsante; toccando una riga il rullo la porta al centro.
 */
export function WheelPicker({
  title,
  items: everyItem,
  selectedId,
  search,
  emptyText,
  confirmLabel = "Conferma",
  confirmOnActiveTap = false,
  footer,
  onActiveChange,
  onConfirm,
  onClose,
}: {
  title: string;
  items: WheelItem[];
  selectedId: string | null;
  /** Testo del campo di ricerca; senza, il campo non c'è. */
  search?: string;
  emptyText?: string;
  confirmLabel?: string;
  /** Un secondo tocco sulla riga al centro la sceglie. */
  confirmOnActiveTap?: boolean;
  footer?: ReactNode;
  /** Chiamata quando cambia la riga al centro. */
  onActiveChange?: (id: string) => void;
  onConfirm: (id: string) => void;
  onClose: () => void;
}) {
  const wheel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const wanted = query.trim().toLocaleLowerCase("it");
  const items = wanted
    ? everyItem.filter((item) => `${item.label} ${item.sub ?? ""}`.toLocaleLowerCase("it").includes(wanted))
    : everyItem;
  const start = wanted ? 0 : Math.max(0, items.findIndex((item) => item.id === selectedId));
  const [pos, setPos] = useState(start);
  const frame = useRef(0);
  const active = Math.min(items.length - 1, Math.max(0, Math.round(pos)));
  const activeId = items[active]?.id;

  useEffect(() => {
    if (activeId) onActiveChange?.(activeId);
  }, [activeId, onActiveChange]);

  useLayoutEffect(() => {
    wheel.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (wheel.current) wheel.current.scrollTop = start * ROW;
    setPos(start);
    // All'apertura e a ogni ricerca: il rullo riparte dalla scelta attuale o dal primo risultato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame.current);
    };
  }, [onClose]);

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (wheel.current) setPos(wheel.current.scrollTop / ROW);
    });
  }

  function goTo(index: number) {
    const next = Math.min(items.length - 1, Math.max(0, index));
    wheel.current?.scrollTo({ top: next * ROW, behavior: "smooth" });
  }

  return (
    <div className="wheel-backdrop" role="presentation" onClick={onClose}>
      <div className="wheel-sheet" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="wheel-head">
          <button className="ghost" type="button" onClick={onClose}>Annulla</button>
          <h2>{title}</h2>
          <button className="primary" type="button" disabled={items.length === 0} onClick={() => onConfirm(items[active].id)}>{confirmLabel}</button>
        </div>
        {search ? (
          <input
            className="wheel-search"
            type="search"
            aria-label={search}
            placeholder={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && items[active]) onConfirm(items[active].id);
            }}
          />
        ) : null}
        <div className="wheel-frame" style={{ height: ROW * VISIBLE }}>
          <div className="wheel-band" aria-hidden="true" style={{ top: ROW * Math.floor(VISIBLE / 2), height: ROW }} />
          <div
            ref={wheel}
            className="wheel"
            role="listbox"
            aria-label={title}
            aria-activedescendant={items[active] ? `wheel-${items[active].id}` : undefined}
            tabIndex={0}
            onScroll={onScroll}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); goTo(active + 1); }
              if (event.key === "ArrowUp") { event.preventDefault(); goTo(active - 1); }
              if (event.key === "Enter" && items[active]) { event.preventDefault(); onConfirm(items[active].id); }
            }}
            style={{ paddingBlock: ROW * Math.floor(VISIBLE / 2) }}
          >
            {items.map((item, index) => {
              const distance = index - pos;
              const tilt = Math.max(-1, Math.min(1, distance / 3));
              return (
                <div
                  key={item.id}
                  id={`wheel-${item.id}`}
                  className="wheel-row"
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  style={{
                    height: ROW,
                    opacity: Math.max(0.25, 1 - Math.abs(distance) * 0.28),
                    transform: `perspective(400px) rotateX(${-tilt * 50}deg) scale(${1 - Math.abs(tilt) * 0.12})`,
                  }}
                  onClick={() => (confirmOnActiveTap && index === active ? onConfirm(item.id) : goTo(index))}
                >
                  {item.role ? (
                    <span className="role-chip" data-role={item.role}>{ROLE_LETTER[item.role]}</span>
                  ) : (
                    <span className="lsw-crest" aria-hidden="true">{item.label.trim().charAt(0).toUpperCase()}</span>
                  )}
                  {item.sub ? (
                    <span className="wheel-two"><strong>{item.label}</strong><small>{item.sub}</small></span>
                  ) : (
                    <strong>{item.label}</strong>
                  )}
                  {item.detail ? <span className="wheel-detail">{item.detail}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
        {items.length === 0 && emptyText ? <p className="wheel-empty">{emptyText}</p> : null}
        {footer}
      </div>
    </div>
  );
}
