"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LeagueSummary } from "@/lib/types";

const MyLeaguesContext = createContext<LeagueSummary[] | null>(null);

/** Le leghe dell'utente già lette dalla parte comune all'apertura dell'app. */
export function MyLeaguesProvider({ leagues, children }: { leagues: LeagueSummary[] | null; children: ReactNode }) {
  return <MyLeaguesContext.Provider value={leagues}>{children}</MyLeaguesContext.Provider>;
}

/** null quando non sono ancora disponibili: chi le usa le chiede al server. */
export function useMyLeagues() {
  return useContext(MyLeaguesContext);
}
