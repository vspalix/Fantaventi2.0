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
  seasons: { rulesets: { table: "rulesets", kind: "one", local: "ruleset_id", foreign: "id" } },
  clubs: { club_translations: { table: "club_translations", kind: "many", local: "id", foreign: "club_id" } },
  season_clubs: { clubs: { table: "clubs", kind: "one", local: "club_id", foreign: "id" } },
};

/** Vincoli di unicità come nel database vero. */
const UNIQUE: Record<string, string[][]> = {
  lineups: [["id"], ["fantasy_team_id", "gameweek_id"]],
  team_gameweek_scores: [["fantasy_team_id", "gameweek_id"]],
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

function matches(row: Row, column: string, filter: string) {
  const dot = filter.indexOf(".");
  const op = filter.slice(0, dot);
  const raw = filter.slice(dot + 1);
  const value = row[column];
  const text = value === null || value === undefined ? null : String(value);
  switch (op) {
    case "eq": return text === raw;
    case "neq": return text !== raw;
    case "is": return raw === "null" ? value == null : text === raw;
    case "in": return text !== null && listValues(raw.replace(/^\((.*)\)$/, "$1")).includes(text);
    case "lt": return value != null && Number(value) < Number(raw);
    case "lte": return value != null && Number(value) <= Number(raw);
    case "gt": return value != null && Number(value) > Number(raw);
    case "gte": return value != null && Number(value) >= Number(raw);
    default: throw new Error(`Filtro non previsto nel finto Supabase: ${op}`);
  }
}

export class FakeSupabase {
  readonly tables: Tables;
  readonly calls: Call[] = [];
  private server: Server | null = null;

  constructor(tables: Tables) {
    this.tables = tables;
  }

  async start() {
    this.server = createServer((request, response) => {
      void this.handle(request).then(({ status, body }) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(body === undefined ? "" : JSON.stringify(body));
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
          const linked = (this.tables[relation.table] ?? []).filter((item) => item[relation.foreign] === row[relation.local]);
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
    let rows = [...(this.tables[table] ?? [])];
    for (const [key, value] of params) {
      if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(key)) continue;
      rows = rows.filter((row) => matches(row, key, value));
    }
    return rows;
  }

  private clash(table: string, row: Row, ignore?: Row) {
    return (UNIQUE[table] ?? []).find((columns) => (this.tables[table] ?? []).some((other) => (
      other !== ignore && columns.every((column) => other[column] === row[column])
    )));
  }

  private async handle(request: IncomingMessage): Promise<{ status: number; body?: unknown }> {
    const url = new URL(request.url ?? "/", "http://fake");
    const [, rest, , table] = url.pathname.split("/");
    const method = request.method ?? "GET";
    this.calls.push({ method, table: table ?? "", query: url.search });
    if (rest !== "rest" || !table) return { status: 404, body: { message: "Servizio non previsto", code: "PGRST000" } };
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
      if (method === "GET") {
        let rows = this.filtered(table, params);
        const order = params.get("order");
        if (order) {
          const [column, direction] = order.split(".");
          rows.sort((left, right) => {
            const a = left[column] as number | string;
            const b = right[column] as number | string;
            return (a < b ? -1 : a > b ? 1 : 0) * (direction === "desc" ? -1 : 1);
          });
        }
        const limit = params.get("limit");
        if (limit) rows = rows.slice(0, Number(limit));
        return respond(rows);
      }
      if (method === "POST") {
        const incoming = (Array.isArray(payload) ? payload : [payload ?? {}]).map((row) => ({ ...row }));
        const merge = prefer.includes("resolution=merge-duplicates");
        const saved: Row[] = [];
        for (const row of incoming) {
          const columns = this.clash(table, row);
          if (columns && merge) {
            const target = (this.tables[table] ?? []).find((other) => columns.every((column) => other[column] === row[column]))!;
            Object.assign(target, row);
            saved.push(target);
            continue;
          }
          if (columns) {
            return {
              status: 409,
              body: { code: "23505", message: `duplicate key value violates unique constraint "${table}_${columns.join("_")}_key"` },
            };
          }
          this.tables[table].push(row);
          saved.push(row);
        }
        return prefer.includes("return=representation") ? respond(saved) : { status: 201 };
      }
      if (method === "PATCH") {
        const rows = this.filtered(table, params);
        for (const row of rows) Object.assign(row, payload);
        return prefer.includes("return=representation") ? respond(rows) : { status: 204 };
      }
      if (method === "DELETE") {
        const gone = new Set(this.filtered(table, params));
        this.tables[table] = this.tables[table].filter((row) => !gone.has(row));
        return prefer.includes("return=representation") ? respond([...gone]) : { status: 204 };
      }
      return { status: 405, body: { message: "Metodo non previsto" } };
    } catch (error) {
      return { status: 400, body: { code: "PGRST100", message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
