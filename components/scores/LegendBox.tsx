import type { ReactNode } from "react";

/** La legenda delle icone: chiusa occupa una riga, si apre toccandola. */
export function LegendBox({ children }: { children: ReactNode }) {
  return (
    <details className="legend-box">
      <summary>Legenda delle icone</summary>
      {children}
    </details>
  );
}
