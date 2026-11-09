import type { PlayerRole } from "@/lib/types";
import type { AdapterSource, ListoneAdapter, NormalizedListone, NormalizedPlayer } from "@/lib/adapters/types";
import { cellText, headerKey, readWorkbook, type SheetGrid } from "@/lib/adapters/excel/workbook";

const NAME_HEADERS = ["nome", "name", "player", "calciatore", "giocatore"];
const CLUB_HEADERS = ["squadra", "team", "club"];
const ROLE_HEADERS = ["ruolo", "role", "position", "pos", "r"];
const ID_HEADERS = ["id", "cod", "codice", "externalref", "code", "playerid"];

const ROLES: Record<string, PlayerRole> = {
  p: "GK",
  por: "GK",
  gk: "GK",
  g: "GK",
  goalkeeper: "GK",
  portiere: "GK",
  d: "DEF",
  dif: "DEF",
  def: "DEF",
  defender: "DEF",
  difensore: "DEF",
  c: "MID",
  cen: "MID",
  mid: "MID",
  m: "MID",
  midfielder: "MID",
  centrocampista: "MID",
  a: "FWD",
  att: "FWD",
  fwd: "FWD",
  f: "FWD",
  forward: "FWD",
  attaccante: "FWD",
};

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function columnIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.includes(header));
}

function mapRole(raw: string) {
  return ROLES[headerKey(raw)] ?? null;
}

function playerFromCells(name: string, clubName: string, roleRaw: string, externalRef: string): NormalizedPlayer | null {
  const role = mapRole(roleRaw);
  if (!name || !clubName || !role) return null;
  const ref = externalRef.replace(/\.0$/, "") || `${slug(clubName)}:${slug(name)}`;
  if (!ref || headerKey(ref) === "id") return null;
  return { externalRef: ref, name, clubName, role };
}

function parseSheet(sheet: SheetGrid) {
  let headerAt = -1;
  const headers: string[] = [];
  for (let index = 0; index < Math.min(sheet.rows.length, 25); index += 1) {
    const keys = sheet.rows[index].map((cell) => headerKey(cellText(cell)));
    if (columnIndex(keys, NAME_HEADERS) >= 0 && columnIndex(keys, CLUB_HEADERS) >= 0 && columnIndex(keys, ROLE_HEADERS) >= 0) {
      headerAt = index;
      headers.push(...keys);
      break;
    }
  }
  if (headerAt < 0) return [];

  const nameAt = columnIndex(headers, NAME_HEADERS);
  const clubAt = columnIndex(headers, CLUB_HEADERS);
  const roleAt = columnIndex(headers, ROLE_HEADERS);
  const idAt = columnIndex(headers, ID_HEADERS);
  const parsed: NormalizedPlayer[] = [];
  for (const row of sheet.rows.slice(headerAt + 1)) {
    const player = playerFromCells(
      cellText(row[nameAt]),
      cellText(row[clubAt]),
      cellText(row[roleAt]),
      idAt >= 0 ? cellText(row[idAt]) : "",
    );
    if (player) parsed.push(player);
  }
  return parsed;
}

function isReleasedSheet(name: string) {
  const key = headerKey(name);
  return key.startsWith("cedut") || key.startsWith("released") || key.startsWith("svincol");
}

function parseJson(value: unknown): NormalizedListone | null {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { players?: unknown }).players)
      ? (value as { players: unknown[] }).players
      : null;
  if (!rows) return null;
  const active: NormalizedPlayer[] = [];
  const released: NormalizedPlayer[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as {
      name?: unknown;
      player?: unknown;
      clubName?: unknown;
      club?: unknown;
      team?: unknown;
      role?: unknown;
      position?: unknown;
      externalRef?: unknown;
      id?: unknown;
      released?: unknown;
    };
    const player = playerFromCells(
      String(item.name ?? item.player ?? ""),
      String(item.clubName ?? item.club ?? item.team ?? ""),
      String(item.role ?? item.position ?? ""),
      String(item.externalRef ?? item.id ?? ""),
    );
    if (!player) continue;
    if (item.released === true) released.push(player);
    else active.push(player);
  }
  return { active, released };
}

async function parse(source: AdapterSource): Promise<NormalizedListone> {
  const fromJson = parseJson(source.json);
  if (fromJson && (fromJson.active.length > 0 || fromJson.released.length > 0)) return fromJson;
  if (!source.bytes || source.bytes.length === 0) {
    throw new Error("Il listone generico legge un .xlsx con intestazioni nome, squadra e ruolo, oppure un JSON con gli stessi campi.");
  }
  const sheets = await readWorkbook(source.bytes);
  const active = new Map<string, NormalizedPlayer>();
  const released = new Map<string, NormalizedPlayer>();
  for (const sheet of sheets) {
    const target = isReleasedSheet(sheet.name) ? released : active;
    for (const player of parseSheet(sheet)) target.set(player.externalRef, player);
  }
  if (active.size === 0 && released.size === 0) {
    throw new Error("Nessuna riga letta. Servono intestazioni per nome (nome, name, player), squadra (squadra, team, club) e ruolo (ruolo, role, position, r).");
  }
  return { active: [...active.values()], released: [...released.values()] };
}

export const genericListoneAdapter: ListoneAdapter = {
  id: "generic-listone",
  label: "Listone generico (intestazioni nome, squadra, ruolo)",
  parse,
};
