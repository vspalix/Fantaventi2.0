"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 8.500h13.500M15 5l3.500 3.500L15 12M19 15.500H5.500M9 12l-3.500 3.500L9 19" />
    </svg>
  );
}

/**
 * Il passaggio tra il gioco e l'area admin, come tra ospite e host: si vede un altro menu.
 * La pagina si ricarica per intero, così intestazione e permessi sono quelli giusti.
 */
export function ViewSwitch({ to, className = "" }: { to: "host" | "player"; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  // Tornando indietro con il browser la pagina può riapparire com'era: la schermata di passaggio va tolta.
  useEffect(() => {
    const reset = () => setState("idle");
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function go() {
    if (state === "busy") return;
    setState("busy");
    try {
      const response = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: to }),
      });
      if (!response.ok) return setState("failed");
      window.location.assign(to === "host" ? "/admin" : "/");
    } catch {
      setState("failed");
    }
  }

  const label = to === "host" ? "Passa all'area Admin" : "Torna al gioco";
  return (
    <>
      <button type="button" className={`view-switch ${className}`.trim()} disabled={state === "busy"} onClick={() => void go()}>
        <SwapIcon />
        {state === "failed" ? "Non riuscito, riprova" : label}
      </button>
      {state === "busy" ? createPortal(
        <div className="view-flip" role="status">
          <span className="view-flip-coin"><SwapIcon /></span>
          <strong>{to === "host" ? "Area Admin" : "Torni al gioco"}</strong>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
