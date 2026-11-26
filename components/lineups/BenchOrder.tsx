"use client";

import { useRef, useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import type { PlayerRole } from "@/lib/types";

export type BenchRow = { id: string; fullName: string; role: PlayerRole; clubShort: string };

const ROLE_LETTER: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };

type Drag = { id: string; from: number; startY: number; offset: number; rowHeight: number };

/**
 * Panchina in ordine di ingresso. Con la maniglia a sinistra si trascina un giocatore
 * in un'altra posizione (dito o mouse); da tastiera la maniglia sposta con le frecce.
 */
export function BenchOrder({
  players,
  editable,
  onMove,
}: {
  players: BenchRow[];
  editable: boolean;
  onMove: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const target = drag
    ? Math.min(players.length - 1, Math.max(0, drag.from + Math.round(drag.offset / drag.rowHeight)))
    : -1;

  function shiftFor(index: number) {
    if (!drag || index === drag.from) return 0;
    if (drag.from < target && index > drag.from && index <= target) return -drag.rowHeight;
    if (drag.from > target && index < drag.from && index >= target) return drag.rowHeight;
    return 0;
  }

  function begin(event: React.PointerEvent<HTMLButtonElement>, id: string, from: number) {
    if (!editable) return;
    // Niente selezione del testo né scorrimento della pagina mentre si trascina
    event.preventDefault();
    const row = (event.currentTarget.closest("li") as HTMLElement | null)?.getBoundingClientRect();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Alcuni browser rifiutano la cattura: il trascinamento funziona lo stesso finché il dito resta sulla maniglia.
    }
    setDrag({ id, from, startY: event.clientY, offset: 0, rowHeight: row?.height || 52 });
  }

  function follow(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const box = list.current?.getBoundingClientRect();
    const raw = event.clientY - drag.startY;
    // Il giocatore trascinato resta dentro la panchina
    const min = box ? -drag.from * drag.rowHeight : raw;
    const max = box ? (players.length - 1 - drag.from) * drag.rowHeight : raw;
    setDrag({ ...drag, offset: Math.min(max, Math.max(min, raw)) });
  }

  function finish() {
    if (!drag) return;
    const to = target;
    const from = drag.from;
    setDrag(null);
    if (to !== from && to >= 0) onMove(from, to);
  }

  return (
    <ol className="bench-order" ref={list} data-dragging={Boolean(drag)}>
      {players.map((player, index) => {
        const dragged = drag?.id === player.id;
        return (
          <li
            key={player.id}
            data-dragged={dragged}
            style={{
              transform: dragged ? `translateY(${drag.offset}px)` : `translateY(${shiftFor(index)}px)`,
              transition: dragged || !drag ? "none" : "transform 160ms ease",
            }}
          >
            <div className="bench-row">
              {editable ? (
                <button
                  className="bench-handle"
                  type="button"
                  aria-label={`Sposta ${player.fullName}, posizione ${index + 1} di ${players.length}. Usa le frecce su e giù.`}
                  onPointerDown={(event) => begin(event, player.id, index)}
                  onPointerMove={follow}
                  onPointerUp={finish}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); onMove(index, index - 1); }
                    if (event.key === "ArrowDown" && index < players.length - 1) { event.preventDefault(); onMove(index, index + 1); }
                  }}
                >
                  <span aria-hidden="true">⋮⋮</span>
                </button>
              ) : null}
              <span className="bench-num">{index + 1}</span>
              <span className="role-chip" data-role={player.role}>{ROLE_LETTER[player.role]}</span>
              <strong>{player.fullName}</strong>
              <span className="bench-club">
                {editable ? null : <TeamBadge teamName={player.clubShort} />} {player.clubShort}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
