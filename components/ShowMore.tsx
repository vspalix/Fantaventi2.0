"use client";

import { useState, type ReactNode } from "react";

// Le liste lunghe si disegnano a pezzi: con migliaia di righe il telefono si blocca.

export function useShown<T>(items: readonly T[], page = 50, label = "altre") {
  const [count, setCount] = useState(page);
  const rest = items.length - count;
  return {
    shown: rest > 0 ? items.slice(0, count) : items,
    more: rest > 0 ? (
      <button className="ghost show-more" type="button" onClick={() => setCount(count + page)}>
        Mostra {label} {Math.min(page, rest)} · ne restano {rest}
      </button>
    ) : null,
  };
}

/** Per le pagine preparate dal server: un elenco `ul` che si allunga a richiesta. */
export function PagedList({ rows, className, page = 50 }: { rows: ReactNode[]; className?: string; page?: number }) {
  const { shown, more } = useShown(rows, page);
  return (
    <>
      <ul className={className}>{shown}</ul>
      {more}
    </>
  );
}

/** Come `PagedList`, per una tabella: l'intestazione resta, le righe si allungano a richiesta. */
export function PagedTable({ head, rows, className, wrapClassName, page = 50 }: { head: ReactNode; rows: ReactNode[]; className?: string; wrapClassName?: string; page?: number }) {
  const { shown, more } = useShown(rows, page);
  return (
    <>
      <div className={wrapClassName}>
        <table className={className}>
          {head}
          <tbody>{shown}</tbody>
        </table>
      </div>
      {more}
    </>
  );
}
