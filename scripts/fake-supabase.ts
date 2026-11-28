// Un finto Supabase in memoria, solo per le prove: risponde alle richieste REST di supabase-js
// (select con filtri e tabelle collegate, insert, upsert, update, delete) senza toccare il database vero.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** Tabelle collegate usate dalle select con `tabella(colonne)`. */
type Relation = { table: string; kind: "many" | "one"; local: string; foreign: string };

const RELATIONS: Record<string, Record<string, Relation>> = {
  lineups: { lineup_slots: { table: "lineup_slots", kind: "many", local: "id", foreign: "lineup_id" } },
  seasons: {
    rulesets: { table: "rulesets", kind: "one", local: "ruleset_id", foreign: "id" },
    competitions: { table: "competitions", kind: "one", local: "competition_id", foreign: "id" },
  },
  competitions: { competition_translations: { table: "competition_translations", kind: "many", local: "id", foreign: "competition_id" } },
  player_registrations: {
    players: { table: "players", kind: "one", local: "player_id", foreign: "id" },
    clubs: { table: "clubs", kind: "one", local: "club_id", foreign: "id" },
  },
  clubs: { club_translations: { table: "club_translations", kind: "many", local: "id", foreign: "club_id" } },
  season_clubs: { clubs: { table: "clubs", kind: "one", local: "club_id", foreign: "id" } },
  private_league_members: {
    fantasy_teams: { table: "fantasy_teams", kind: "one", local: "fantasy_team_id", foreign: "id" },
    private_leagues: { table: "private_leagues", kind: "one", local: "private_league_id", foreign: "id" },
  },
};

/** Come il database vero: una lettura restituisce al massimo 1000 righe e taglia il resto senza errori. */
const MAX_ROWS = 1000;
/** Oltre questa lunghezza la richiesta viene rifiutata, come fa un server vero con un indirizzo troppo lungo. */
const MAX_URL = 16 * 1024;

/** Vincoli di unicità come nel database vero. */
const UNIQUE: Record<string, string[][]> = {
  lineups: [["id"], ["fantasy_team_id", "gameweek_id"]],
  team_gameweek_scores: [["fantasy_team_id", "gameweek_id"]],
  engagement_notices: [["dedupe_key"]],
};

export type Call = { method: string; table: string; query: string };

function splitTop(text: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function listValues(text: string) {
  return splitTop(text).map((value) => value.replace(/^"(.*)"$/, "$1"));
}

/** L'elenco di un filtro `in` si legge una volta sola, non a ogni riga. */
let lastList = { raw: "", values: new Set<string>() };

function listSet(raw: string) {
  if (lastList.raw !== raw) lastList = { raw, values: new Set(listValues(raw.replace(/^\((.*)\)$/, "$1"))) };
  return lastList.values;
}

/** Il modello di `like`: `%` (o `*`) vale per qualunque testo, `_` per un carattere. */
function pattern(raw: string, flags: string) {
  const source = raw.replace(/[.+?^$\{}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${source}$`, flags);
}

/** Numeri come numeri; il resto, date comprese, come testo. */
function order(value: unknown, raw: string) {
  const left = Number(value);
  const right = Number(raw);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(value) < raw ? -1 : String(value) > raw ? 1 : 0;
}

function matches(row: Row, column: string, filter: string) {
  const dot = filter.indexOf(".");
  const op = filter.slice(0, dot);
  const raw = filter.slice(dot + 1);
  // `settings->>visibility`: una voce dentro una colonna JSON, letta come testo.
  const [base, key] = column.split("->>");
  const value = key === undefined ? row[column] : (row[base] as Record<string, unknown> | null | undefined)?.[key];
  const text = value === null || value === undefined ? null : String(value);
  switch (op) {
    case "eq": return text === raw;
    case "neq": return text !== raw;
    case "is": return raw === "null" ? value == null : text === raw;
    case "in": return text !== null && listSet(raw).has(text);
    case "like": return text !== null && pattern(raw, "").test(text);
    case "ilike": return text !== null && pattern(raw, "i").test(text);
    case "lt": return value != null && order(value, raw) < 0;
    case "lte": return value != null && order(value, raw) <= 0;
    case "gt": return value != null && order(value, raw) > 0;
    case "gte": return value != null && order(value, raw) >= 0;
    default: throw new Error(`Filtro non previsto nel finto Supabase: ${op}`);
  }
}

export class FakeSupabase {
  readonly tables: Tables;
  readonly calls: Call[] = [];
  /** Byte di risposta mandati: quanto traffico farebbe il database vero. */
  sent = 0;
  private server: Server | null = null;
  private readonly indexed: boolean;
  /** Per le prove di carico: righe raggruppate per valore, così non si scorre ogni volta tutta la tabella. */
  private readonly groups = new Map<string, Map<string, Row[]>>();

  /** `indexed` solo se le tabelle si cambiano attraverso le richieste, non a mano durante la prova. */
  constructor(tables: Tables, options: { indexed?: boolean } = {}) {
    this.tables = tables;
    this.indexed = Boolean(options.indexed);
  }

  private grouped(table: string, column: string) {
    const name = `${table}.${column}`;
    let found = this.groups.get(name);
    if (!found) {
      found = new Map();
      for (const row of this.tables[table] ?? []) {
        const key = String(row[column]);
        const list = found.get(key);
        if (list) list.push(row);
        else found.set(key, [row]);
      }
      this.groups.set(name, found);
    }
    return found;
  }

  private forget(table: string) {
    for (const name of [...this.groups.keys()]) {
      if (name.startsWith(`${table}.`)) this.groups.delete(name);
    }
  }

  async start() {
    // Il limite di Node resta largo: l'indirizzo troppo lungo lo rifiuta `handle`, con un messaggio.
    this.server = createServer({ maxHeaderSize: 1024 * 1024 }, (request, response) => {
      void this.handle(request).then(({ status, body, count }) => {
        response.writeHead(status, {
          "content-type": "application/json",
          ...(count === undefined ? {} : { "content-range": `*/${count}` }),
        });
        const text = body === undefined ? "" : JSON.stringify(body);
        this.sent += Buffer.byteLength(text);
        response.end(text);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  writes() {
    return this.calls.filter((call) => call.method !== "GET" && call.method !== "HEAD");
  }

  private select(table: string, rows: Row[], select: string): Row[] {
    const fields = splitTop(select || "*");
    return rows.map((row) => {
      const out: Row = {};
      for (const field of fields) {
        const embed = field.match(/^(\w+)\(([\s\S]*)\)$/);
        if (embed) {
          const relation = RELATIONS[table]?.[embed[1]];
          if (!relation) throw new Error(`Collegamento non previsto: ${table}.${embed[1]}`);
          const linked = this.indexed
            ? this.grouped(relation.table, relation.foreign).get(String(row[relation.local])) ?? []
            : (this.tables[relation.table] ?? []).filter((item) => item[relation.foreign] === row[relation.local]);
          const shaped = this.select(relation.table, linked, embed[2]);
          out[embed[1]] = relation.kind === "many" ? shaped : shaped[0] ?? null;
          continue;
        }
        if (field === "*") Object.assign(out, row);
        else out[field] = row[field] ?? null;
      }
      return out;
    });
  }

  private filtered(table: string, params: URLSearchParams) {
    const filters = [...params].filter(([key]) => !["select", "order", "limit", "offset", "columns", "on_conflict"].includes(key));
    let rows: Row[] | null = null;
    if (this.indexed) {
      // Si parte dal filtro che lascia meno righe.
      for (const [key, value] of filters) {
        if (key.includes("->>") || !/^(eq|in)\./.test(value)) continue;
        const values = value.startsWith("eq.") ? [value.slice(3)] : [...listSet(value.slice(3))];
        const groups = this.grouped(table, key);
        const size = values.reduce((sum, item) => sum + (groups.get(item)?.length ?? 0), 0);
        if (rows === null || size < rows.length) rows = values.flatMap((item) => groups.get(item) ?? []);
      }
    }
    rows ??= [...(this.tables[table] ?? [])];
    for (const [key, value] of filters) rows = rows.filter((row) => matches(row, key, value));
    return rows;
  }

  /** La riga già presente che viola un vincolo di unicità, con le colonne del vincolo. */
  private clash(table: string, row: Row) {
    for (const columns of UNIQUE[table] ?? []) {
      const candidates = this.indexed
        ? this.grouped(table, columns[0]).get(String(row[columns[0]])) ?? []
        : this.tables[table] ?? [];
      const other = candidates.find((item) => columns.every((column) => item[column] === row[column]));
      if (other) return { columns, other };
    }
    return null;
  }

  private async handle(request: IncomingMessage): Promise<{ status: number; body?: unknown; count?: number }> {
    const url = new URL(request.url ?? "/", "http://fake");
    const [, rest, , table] = url.pathname.split("/");
    const method = request.method ?? "GET";
    this.calls.push({ method, table: table ?? "", query: url.search });
    if (rest !== "rest" || !table) return { status: 404, body: { message: "Servizio non previsto", code: "PGRST000" } };
    if ((request.url ?? "").length > MAX_URL) return { status: 414, body: { message: "URI too long", code: "PGRST000" } };
    if (!(table in this.tables)) {
      return { status: 404, body: { message: `Could not find the table 'public.${table}' in the schema cache`, code: "PGRST205" } };
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const payload = text ? JSON.parse(text) as Row | Row[] : null;
    const params = url.searchParams;
    const prefer = String(request.headers.prefer ?? "");
    const wantsObject = String(request.headers.accept ?? "").includes("vnd.pgrst.object");
    const respond = (rows: Row[]) => {
      const shaped = params.get("select") ? this.select(table, rows, params.get("select") ?? "*") : rows;
      if (!wantsObject) return { status: 200, body: shaped };
      if (shaped.length !== 1) return { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      return { status: 200, body: shaped[0] };
    };
    try {
      if (method === "HEAD") return { status: 200, count: this.filtered(table, params).length };
      if (method === "GET") {
        let rows = this.filtered(table, params);
        const sorts = (params.get("order") ?? "").split(",").filter(Boolean).map((part) => part.split("."));
        if (sorts.length > 0) {
          rows.sort((left, right) => {
            for (const [column, direction] of sorts) {
              const a = left[column] as number | string;
              const b = right[column] as number | string;
              if (a !== b) return (a < b ? -1 : 1) * (direction === "desc" ? -1 : 1);
            }
            return 0;
          });
        }
        const offset = Number(params.get("offset") ?? 0);
        const limit = Math.min(Number(params.get("limit") ?? MAX_ROWS), MAX_ROWS);
        return respond(rows.slice(offset, offset + limit));
      }
      if (method === "POST") {
        const incoming = (Array.isArray(payload) ? payload : [payload ?? {}]).map((row) => ({ ...row }));
        const merge = prefer.includes("resolution=merge-duplicates");
        const ignore = prefer.includes("resolution=ignore-duplicates");
        const saved: Row[] = [];
        for (const row of incoming) {
          const found = this.clash(table, row);
          if (found && merge) {
            Object.assign(found.other, row);
            saved.push(found.other);
            continue;
          }
          if (found && ignore) continue;
          if (found) {
            return {
              status: 409,
              body: { code: "23505", message: `duplicate key value violates unique constraint "${table}_${found.columns.join("_")}_key"` },
            };
          }
          this.tables[table].push(row);
          saved.push(row);
          // I gruppi già costruiti per questa tabella ricevono la riga nuova.
          for (const [name, groups] of this.groups) {
            if (!name.startsWith(`${table}.`)) continue;
            const key = String(row[name.slice(table.length + 1)]);
            const list = groups.get(key);
            if (list) list.push(row);
            else groups.set(key, [row]);
          }
        }
        return prefer.includes("return=representation") ? respond(saved) : { status: 201 };
      }
      if (method === "PATCH") {
        const rows = this.filtered(table, params);
        for (const row of rows) Object.assign(row, payload);
        this.forget(table);
        return prefer.includes("return=representation") ? respond(rows) : { status: 204 };
      }
      if (method === "DELETE") {
        const gone = new Set(this.filtered(table, params));
        if (gone.size > 0) {
          this.tables[table] = this.tables[table].filter((row) => !gone.has(row));
          this.forget(table);
        }
        return prefer.includes("return=representation") ? respond([...gone]) : { status: 204 };
      }
      return { status: 405, body: { message: "Metodo non previsto" } };
    } catch (error) {
      return { status: 400, body: { code: "PGRST100", message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
