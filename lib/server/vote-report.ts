// Il testo dell'avviso Telegram sui voti inseriti. Funzioni pure: nessun database, nessuna rete.
import { SERIE_A_CLUBS } from "@/lib/club-colors";
import type { FantacalcioPlayerVote } from "@/lib/server/fantacalcio-live";

export type VoteReportMatch = {
  home: string;
  away: string;
  /** true se i voti sono quelli ufficiali, false se provvisori. */
  official: boolean;
  /** Solo i calciatori con voto delle due squadre. */
  votes: FantacalcioPlayerVote[];
};

export type VoteReport = {
  gameweek: number;
  /** Quale lettura: «fine primo tempo», «fine partita», «mattina dopo il turno»... */
  label: string;
  matches: VoteReportMatch[];
};

function clubName(code: string) {
  return SERIE_A_CLUBS.find((club) => club.code === code)?.name ?? code.charAt(0).toUpperCase() + code.slice(1);
}

function players(count: number) {
  return count === 1 ? "1 calciatore" : `${count} calciatori`;
}

/**
 * Una riga per squadra con i calciatori inseriti. `listed` sono i codici presenti nel listone:
 * gli altri non vengono salvati. Restituisce null se non è stato inserito nessun voto.
 */
export function voteReportText(report: VoteReport, listed: ReadonlySet<string>) {
  let total = 0;
  const lines: string[] = [];
  for (const official of [true, false]) {
    const rows: string[] = [];
    for (const match of report.matches.filter((item) => item.official === official)) {
      for (const code of [match.home, match.away]) {
        const published = match.votes.filter((vote) => vote.teamSlug === code);
        const saved = published.filter((vote) => listed.has(vote.externalRef)).length;
        const missing = published.length - saved;
        total += saved;
        const note = missing > 0 ? ` (${missing} non nel listone)` : "";
        rows.push(`• ${clubName(code)}: ${saved === 0 && missing === 0 ? "nessun voto" : players(saved)}${note}`);
      }
    }
    if (rows.length > 0) lines.push(official ? "Voti ufficiali:" : "Voti provvisori:", ...rows);
  }
  if (total === 0) return null;
  return [`Giornata ${report.gameweek} · ${report.label}`, ...lines, `Totale inseriti: ${players(total)}.`].join("\n");
}
