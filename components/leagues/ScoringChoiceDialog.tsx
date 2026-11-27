"use client";

import type { ScoringApply } from "@/lib/scoring-history";
import type { ScoringChoice } from "@/lib/types";

/** A lega iniziata, un bonus cambiato può valere da adesso oppure riscrivere anche le giornate passate. */
export function ScoringChoiceDialog({ choice, lastMatchday, pending, onPick, onCancel }: {
  choice: ScoringChoice;
  lastMatchday: number;
  pending: boolean;
  onPick: (apply: ScoringApply) => void;
  onCancel: () => void;
}) {
  const left = choice.fromMatchday <= lastMatchday;
  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation">
      <div className="modal stack" role="dialog" aria-modal="true" aria-labelledby="scoring-choice-title">
        <h2 id="scoring-choice-title">Da quando vale la modifica?</h2>
        <p>Stai cambiando: <strong>{choice.changed.join(", ")}</strong>.</p>
        {left ? (
          <>
            <button className="primary" type="button" disabled={pending} onClick={() => onPick("from-now")}>
              Da ora, dalla giornata {choice.fromMatchday}
            </button>
            <p className="small muted">Le giornate già giocate o in corso restano con i valori di prima.</p>
          </>
        ) : null}
        <button className={left ? "ghost" : "primary"} type="button" disabled={pending} onClick={() => onPick("all")}>
          Ricalcola tutte le giornate
        </button>
        <p className="small muted">Il nuovo valore vale dall&apos;inizio della lega: punti e classifica possono cambiare.</p>
        <button className="text-button" type="button" disabled={pending} onClick={onCancel}>Annulla, non salvare</button>
      </div>
    </div>
  );
}
