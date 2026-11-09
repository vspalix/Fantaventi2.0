import type { AdapterSource, NormalizedVote, VotesAdapter } from "@/lib/adapters/types";
import { cellText, headerKey, readWorkbook, requireBytes } from "@/lib/adapters/excel/workbook";

const HEADER_NAMES: Record<string, keyof NormalizedVote | "role"> = {
  cod: "externalRef",
  codice: "externalRef",
  ruolo: "role",
  nome: "name",
  voto: "voto",
  gf: "goals",
  gs: "goalsConceded",
  rp: "penaltiesScored",
  rs: "penaltiesMissed",
  rf: "penaltiesSaved",
  au: "ownGoals",
  amm: "yellowCards",
  esp: "redCards",
  ass: "assists",
};

function parseVoto(value: string | number | null): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value >= 0 && value <= 10 ? value : null;
  const text = value.trim().toLowerCase().replace(",", ".");
  if (!text || text === "-" || text === "s.v." || text === "sv" || text === "sv." || text === "n.d.") return null;
  if (!/^\d+(?:\.\d+)?\s*\*?$/.test(text)) return null;
  const vote = Number(text.replace("*", "").trim());
  if (Number.isNaN(vote) || vote < 0 || vote > 10) return null;
  return vote;
}

function parseCount(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  const text = cellText(value);
  if (!text) return 0;
  const parsed = Number(text.replace(",", "."));
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function isHeader(row: (string | number | null)[]) {
  const keys = row.map((cell) => headerKey(cellText(cell)));
  return keys.includes("cod") || keys.includes("codice") || keys.includes("voto");
}

const SHEET_LABELS = new Set(["tutti", "voti", "foglio1", "fantacalcio", "statistico", "italia"]);

function isClubRow(row: (string | number | null)[]) {
  const filled = row.map((cell) => cellText(cell)).filter((text) => text);
  if (filled.length === 0) return false;
  const text = filled[0];
  if (filled.some((cell) => cell !== text)) return false;
  const key = headerKey(text);
  if (!key || key === "cod" || key === "codice" || key === "voto" || key === "nome" || key === "ruolo") return false;
  return !/^\d+(?:\.\d+)?$/.test(text);
}

function sheetsToRead<T extends { name: string }>(sheets: T[]) {
  const official = sheets.filter((sheet) => headerKey(sheet.name) === "fantacalcio");
  if (official.length > 0) return official;
  return sheets.filter((sheet) => !["statistico", "italia"].includes(headerKey(sheet.name)));
}

async function parseFile(buffer: Buffer) {
  const sheets = await readWorkbook(buffer);
  const votes: NormalizedVote[] = [];
  let skippedWithoutVote = 0;
  const seen = new Set<string>();

  for (const sheet of sheetsToRead(sheets)) {
    let club = "";
    const sheetClub = sheet.name.trim();
    let columns = new Map<keyof NormalizedVote | "role", number>();
    if (sheetClub && !SHEET_LABELS.has(headerKey(sheetClub))) club = sheetClub;

    for (const row of sheet.rows) {
      if (isHeader(row)) {
        columns = new Map();
        row.forEach((cell, index) => {
          const field = HEADER_NAMES[headerKey(cellText(cell))];
          if (field) columns.set(field, index);
        });
        continue;
      }
      if (isClubRow(row)) {
        club = cellText(row[0]);
        continue;
      }
      if (!club || !columns.has("externalRef")) continue;
      const externalRef = cellText(row[columns.get("externalRef") ?? -1]).replace(/\.0$/, "");
      const name = cellText(row[columns.get("name") ?? -1]);
      if (!externalRef || !name || seen.has(externalRef)) continue;
      const role = headerKey(cellText(row[columns.get("role") ?? -1]));
      if (role === "all") {
        seen.add(externalRef);
        continue;
      }
      const voto = parseVoto(row[columns.get("voto") ?? -1] ?? null);
      seen.add(externalRef);
      if (voto === null) {
        skippedWithoutVote += 1;
        continue;
      }
      const read = (field: keyof NormalizedVote) => parseCount(row[columns.get(field) ?? -1]);
      votes.push({
        externalRef,
        clubName: club,
        name,
        voto,
        goals: read("goals"),
        assists: read("assists"),
        yellowCards: read("yellowCards"),
        redCards: read("redCards"),
        penaltiesScored: read("penaltiesScored"),
        penaltiesMissed: read("penaltiesMissed"),
        penaltiesSaved: read("penaltiesSaved"),
        ownGoals: read("ownGoals"),
        goalsConceded: read("goalsConceded"),
      });
    }
  }

  if (votes.length === 0 && skippedWithoutVote === 0) {
    throw new Error("Questo file Excel non contiene voti riconoscibili.");
  }
  return { votes, skippedWithoutVote };
}

export const fantacalcioVotesAdapter: VotesAdapter = {
  id: "fantacalcio-xlsx-votes",
  label: "Voti Excel",
  parse(source: AdapterSource) {
    return parseFile(requireBytes(source, this.label));
  },
};
