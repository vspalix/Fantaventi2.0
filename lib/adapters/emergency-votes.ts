import type { NormalizedVote } from "@/lib/adapters/types";

export type EmergencyVote = Omit<NormalizedVote, "voto"> & { voto: number | null };
export type EmergencyVotes = { votes: EmergencyVote[] };

export class EmergencyVoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmergencyVoteError";
  }
}

const HEADERS: Record<string, keyof NormalizedVote | "skip"> = {
  externalref: "externalRef",
  codice: "externalRef",
  code: "externalRef",
  id: "externalRef",
  name: "name",
  nome: "name",
  calciatore: "name",
  clubname: "clubName",
  club: "clubName",
  squadra: "clubName",
  voto: "voto",
  goals: "goals",
  gol: "goals",
  assists: "assists",
  assist: "assists",
  yellowcards: "yellowCards",
  ammonizioni: "yellowCards",
  ammonizione: "yellowCards",
  redcards: "redCards",
  espulsioni: "redCards",
  espulsione: "redCards",
  penaltiesscored: "penaltiesScored",
  rigorisegnati: "penaltiesScored",
  rigoresegnato: "penaltiesScored",
  penaltiesmissed: "penaltiesMissed",
  rigorisbagliati: "penaltiesMissed",
  rigoresbagliato: "penaltiesMissed",
  penaltiessaved: "penaltiesSaved",
  rigoriparati: "penaltiesSaved",
  rigoreparato: "penaltiesSaved",
  owngoals: "ownGoals",
  autogol: "ownGoals",
  goalsconceded: "goalsConceded",
  golsubiti: "goalsConceded",
  postponed: "postponed",
  rinviata: "postponed",
};

const COUNT_FIELDS = [
  "goals",
  "assists",
  "yellowCards",
  "redCards",
  "penaltiesScored",
  "penaltiesMissed",
  "penaltiesSaved",
  "ownGoals",
  "goalsConceded",
] as const;

export function parseEmergencyVotes(text: string, fileName = ""): EmergencyVotes {
  const body = text.replace(/^\uFEFF/, "").trim();
  if (!body) throw new EmergencyVoteError("Il file di emergenza è vuoto. Nessun voto salvato.");
  const lower = fileName.toLowerCase();
  const rows = lower.endsWith(".csv") || (!lower.endsWith(".json") && !body.startsWith("{") && !body.startsWith("["))
    ? rowsFromCsv(body)
    : rowsFromJson(body);
  if (rows.length === 0) throw new EmergencyVoteError("Il file non contiene calciatori. Nessun voto salvato.");
  const votes = rows.map((row, index) => voteFromRow(row, index + 1));
  const seen = new Set<string>();
  for (const vote of votes) {
    const key = vote.externalRef.toLowerCase();
    if (seen.has(key)) throw new EmergencyVoteError(`Codice ${vote.externalRef} ripetuto. Nessun voto salvato.`);
    seen.add(key);
  }
  return { votes };
}

function rowsFromJson(body: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new EmergencyVoteError("JSON non leggibile. Nessun voto salvato.");
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { votes?: unknown }).votes)
      ? (parsed as { votes: unknown[] }).votes
      : null;
  if (!rows) throw new EmergencyVoteError("Il JSON deve essere un elenco oppure { votes: [] }. Nessun voto salvato.");
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new EmergencyVoteError(`Riga ${index + 1}: oggetto voto mancante. Nessun voto salvato.`);
    }
    return row as Record<string, unknown>;
  });
}

function rowsFromCsv(body: string): Record<string, unknown>[] {
  const lines = parseCsv(body).filter((line) => line.some((cell) => cell.trim() !== ""));
  if (lines.length < 2) throw new EmergencyVoteError("Il CSV deve avere l'intestazione e almeno un calciatore. Nessun voto salvato.");
  const header = lines[0].map((cell) => {
    const mapped = HEADERS[normalizeHeader(cell)];
    return mapped ?? "";
  });
  if (!header.includes("externalRef")) {
    throw new EmergencyVoteError("Manca la colonna codice (externalRef o codice). Nessun voto salvato.");
  }
  if (!header.includes("voto")) {
    throw new EmergencyVoteError("Manca la colonna voto. Nessun voto salvato.");
  }
  return lines.slice(1).map((line) => {
    const row: Record<string, unknown> = {};
    header.forEach((key, index) => {
      if (key) row[key] = line[index] ?? "";
    });
    return row;
  });
}

function voteFromRow(row: Record<string, unknown>, line: number): EmergencyVote {
  const read = (key: keyof NormalizedVote) => {
    if (key in row) return row[key];
    const match = Object.entries(row).find(([name]) => HEADERS[normalizeHeader(name)] === key);
    return match?.[1];
  };
  const externalRef = String(read("externalRef") ?? "").trim();
  if (!externalRef) throw new EmergencyVoteError(`Riga ${line}: manca il codice calciatore. Nessun voto salvato.`);
  const votoText = String(read("voto") ?? "").trim().toLowerCase();
  let voto: number | null = null;
  if (votoText !== "" && votoText !== "-" && votoText !== "sv" && votoText !== "s.v." && votoText !== "n.d.") {
    const parsed = Number(votoText.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
      throw new EmergencyVoteError(`Riga ${line}: voto «${votoText}» non valido. Nessun voto salvato.`);
    }
    voto = parsed;
  }
  const counts = {} as Record<(typeof COUNT_FIELDS)[number], number>;
  for (const field of COUNT_FIELDS) {
    const raw = String(read(field) ?? "").trim();
    if (raw === "") {
      counts[field] = 0;
      continue;
    }
    const parsed = Number(raw.replace(",", "."));
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new EmergencyVoteError(`Riga ${line}: ${field} deve essere un intero maggiore o uguale a zero. Nessun voto salvato.`);
    }
    counts[field] = parsed;
  }
  const postponedText = String(read("postponed") ?? "").trim().toLowerCase();
  return {
    externalRef,
    name: String(read("name") ?? externalRef).trim() || externalRef,
    clubName: String(read("clubName") ?? "").trim(),
    voto,
    ...counts,
    postponed: postponedText === "1" || postponedText === "true" || postponedText === "si" || postponedText === "sì",
  };
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsv(body: string) {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quoted && char === "\"" && body[index + 1] === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && body[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
