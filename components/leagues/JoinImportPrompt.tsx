"use client";

import { BusyLabel } from "@/components/BusyLabel";
import type { RosterImportSource } from "@/lib/types";

export function JoinImportPrompt({
  targetName,
  sources,
  pending,
  onPick,
}: {
  targetName: string;
  sources: RosterImportSource[];
  pending: boolean;
  onPick: (importFromLeagueId: string | null) => void;
}) {
  return (
    <section className="card stack">
      <h2>Porti una rosa?</h2>
      <p>Stai entrando in {targetName}. Puoi partire da una rosa che hai già, oppure da zero. La copia resta indipendente: i cambi dopo non si riflettono sull&apos;altra lega.</p>
      {sources.map((source) => (
        <button key={source.leagueId} className="primary" type="button" disabled={pending} aria-busy={pending} onClick={() => onPick(source.leagueId)}>
          <BusyLabel pending={pending} idle={`Importa da ${source.leagueName} · ${source.players} calciatori`} busy="Iscrizione..." />
        </button>
      ))}
      <button className="ghost" type="button" disabled={pending} onClick={() => onPick(null)}>
        Entra con una rosa vuota
      </button>
    </section>
  );
}
