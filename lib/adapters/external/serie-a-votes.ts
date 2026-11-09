import type { AdapterSource, NormalizedVote, VotesAdapter } from "@/lib/adapters/types";

function asVote(value: unknown): NormalizedVote | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<NormalizedVote>;
  if (!row.externalRef || !row.name || !row.clubName) return null;
  const voto = row.voto == null ? null : Number(row.voto);
  if (voto !== null && (!Number.isFinite(voto) || voto < 0 || voto > 10)) return null;
  return {
    externalRef: String(row.externalRef),
    name: String(row.name),
    clubName: String(row.clubName),
    voto: voto ?? 0,
    goals: Number(row.goals ?? 0),
    assists: Number(row.assists ?? 0),
    yellowCards: Number(row.yellowCards ?? 0),
    redCards: Number(row.redCards ?? 0),
    penaltiesScored: Number(row.penaltiesScored ?? 0),
    penaltiesMissed: Number(row.penaltiesMissed ?? 0),
    penaltiesSaved: Number(row.penaltiesSaved ?? 0),
    ownGoals: Number(row.ownGoals ?? 0),
    goalsConceded: Number(row.goalsConceded ?? 0),
    postponed: Boolean(row.postponed),
  };
}

export const serieAVotesAdapter: VotesAdapter = {
  id: "serie-a-api-votes",
  label: "API Serie A",
  async parse(source: AdapterSource) {
    if (source.json == null) {
      throw new Error("Il recupero automatico dalla Serie A non è ancora collegato. Importa il file voti oppure passa un JSON già normalizzato.");
    }
    const payload = source.json as { votes?: unknown };
    const rows = Array.isArray(source.json) ? source.json : payload.votes;
    if (!Array.isArray(rows)) {
      throw new Error("Il JSON dei voti deve essere un elenco oppure un oggetto { votes: [] }.");
    }
    const votes = rows.flatMap((row) => {
      const vote = asVote(row);
      return vote ? [vote] : [];
    });
    return { votes, skippedWithoutVote: rows.length - votes.length };
  },
};
