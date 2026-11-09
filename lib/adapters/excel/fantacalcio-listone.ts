import type { PlayerRole } from "@/lib/types";
import type { AdapterSource, ListoneAdapter, NormalizedPlayer } from "@/lib/adapters/types";
import { cellText, headerKey, readWorkbook, requireBytes, type SheetGrid } from "@/lib/adapters/excel/workbook";

const ROLE_SHEETS: Record<string, PlayerRole> = {
  portieri: "GK",
  difensori: "DEF",
  centrocampisti: "MID",
  attaccanti: "FWD",
};

// Listone Fantacalcio della Serie A: la R è in colonna B (P, D, C, A).
// La colonna RM, di solito la C, descrive la manovra e non assegna il ruolo.
// Un'altra competizione avrà un adapter proprio, con il suo schema di colonne.
const SERIE_A_ROLE_COLUMN = 1;

function coarseRole(raw: string): PlayerRole | null {
  const key = headerKey(raw);
  if (key === "p" || key === "por") return "GK";
  if (key === "d") return "DEF";
  if (key === "c") return "MID";
  if (key === "a") return "FWD";
  return null;
}

function roleColumn(headers: string[]) {
  const named = headers.findIndex((header) => header === "r");
  return named >= 0 ? named : SERIE_A_ROLE_COLUMN;
}

function columnIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.includes(header));
}

function parseSheet(sheet: SheetGrid, sheetRole: PlayerRole | null): NormalizedPlayer[] {
  let headerAt = -1;
  const headers: string[] = [];
  for (let index = 0; index < Math.min(sheet.rows.length, 20); index += 1) {
    const keys = sheet.rows[index].map((cell) => headerKey(cellText(cell)));
    if (keys.includes("nome") && (keys.includes("id") || keys.includes("squadra") || keys.includes("r"))) {
      headerAt = index;
      headers.push(...keys);
      break;
    }
  }
  if (headerAt < 0) return [];

  const idAt = columnIndex(headers, ["id", "cod", "codice"]);
  const nameAt = columnIndex(headers, ["nome", "calciatore"]);
  const clubAt = columnIndex(headers, ["squadra", "team", "club"]);
  const roleAt = roleColumn(headers);
  const parsed: NormalizedPlayer[] = [];

  for (const row of sheet.rows.slice(headerAt + 1)) {
    const externalRef = cellText(idAt >= 0 ? row[idAt] : null).replace(/\.0$/, "");
    const name = cellText(nameAt >= 0 ? row[nameAt] : null);
    const clubName = cellText(clubAt >= 0 ? row[clubAt] : null);
    if (!externalRef || !name || !clubName) continue;
    if (headerKey(externalRef) === "id") continue;
    const role = coarseRole(cellText(row[roleAt])) ?? sheetRole;
    if (!role) continue;
    parsed.push({ externalRef, name, clubName, role });
  }
  return parsed;
}

async function parseFile(buffer: Buffer) {
  const sheets = await readWorkbook(buffer);
  const byKey = new Map(sheets.map((sheet) => [headerKey(sheet.name), sheet]));
  const releasedSheet = [...byKey.entries()].find(([key]) => key.startsWith("cedut"))?.[1] ?? null;
  const tutti = byKey.get("tutti") ?? null;
  const active = new Map<string, NormalizedPlayer>();
  if (tutti) {
    for (const player of parseSheet(tutti, null)) active.set(player.externalRef, player);
  } else {
    for (const [key, role] of Object.entries(ROLE_SHEETS) as [string, PlayerRole][]) {
      const sheet = byKey.get(key);
      if (!sheet) continue;
      for (const player of parseSheet(sheet, role)) active.set(player.externalRef, player);
    }
  }

  const released = new Map<string, NormalizedPlayer>();
  if (releasedSheet) {
    for (const player of parseSheet(releasedSheet, null)) {
      released.set(player.externalRef, player);
      active.delete(player.externalRef);
    }
  }

  const listone = { active: [...active.values()], released: [...released.values()] };
  if (listone.active.length === 0 && listone.released.length === 0) {
    throw new Error("Questo file Excel non contiene un listone riconoscibile.");
  }
  return listone;
}

export const fantacalcioListoneAdapter: ListoneAdapter = {
  id: "fantacalcio-xlsx-listone",
  label: "Quotazioni Excel",
  parse(source: AdapterSource) {
    return parseFile(requireBytes(source, this.label));
  },
};
