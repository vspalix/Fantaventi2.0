// Cosa mostrare a chi usa l'app e cosa si può scrivere nei registri e negli avvisi.
// Nessuna dipendenza da Next o dal database: si prova da sola nella suite.

export const SIMPLE_ERROR = "Qualcosa non ha funzionato dalla nostra parte. Riprova tra poco.";
export const UNREADABLE_REQUEST = "La richiesta non è arrivata per intero. Ricarica la pagina e riprova.";

const TECHNICAL = new RegExp([
  "fetch failed", "failed to fetch", "ECONN", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "socket hang up", "other side closed",
  "network", "timeout", "timed out", "aborted", "canceling statement", "deadlock", "too many (clients|connections)",
  "connection (terminated|refused|closed|reset)",
  "relation \"", "does not exist", "schema cache", "could not find the", "PGRST\\d", "violates [a-z -]*constraint", "duplicate key value",
  "permission denied", "row-level security", "\\bJWT\\b", "invalid api key", "invalid input (syntax|value)", "syntax error",
  "value too long", "out of range", "null value in column", "multiple \\(or no\\) rows", "JSON object requested", "database error",
  "cannot (read|set) propert", "is not a function", "is not defined", "is not iterable", "unexpected token", "unexpected end of",
  "<!doctype", "<html", "internal server error", "bad gateway", "service (is )?unavailable", "gateway time-?out",
  "Manca SUPABASE_", "Mancano NEXT_PUBLIC", "API_FOOTBALL_KEY",
].join("|"), "i");

const UNREACHABLE = /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|other side closed|connection (terminated|refused|closed|reset)|bad gateway|service (is )?unavailable|gateway time-?out/i;

// Messaggi arrivati dal database in questa istanza: sono tecnici anche quando le parole non lo dicono.
const databaseMessages = new Map<string, { group: string | null }>();

/** `group` è il gruppo dell'avviso già partito per quel guasto, se ce n'è uno. */
export function rememberDatabaseMessage(message: string, group: string | null) {
  if (!message) return;
  databaseMessages.delete(message);
  databaseMessages.set(message, { group });
  if (databaseMessages.size > 200) databaseMessages.delete(databaseMessages.keys().next().value as string);
}

function field(error: unknown, name: string): unknown {
  return typeof error === "object" && error ? (error as Record<string, unknown>)[name] : undefined;
}

export function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const message = field(error, "message");
  return typeof message === "string" ? message : "";
}

/** Segnali interni di Next (cambio pagina, pagina non trovata): non sono errori. */
export function isFrameworkSignal(error: unknown) {
  const digest = field(error, "digest");
  return typeof digest === "string" && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT)/.test(digest);
}

function isUnreadableRequest(error: unknown) {
  return error instanceof SyntaxError && /JSON/i.test(error.message);
}

export function isTechnicalError(error: unknown) {
  if (isUnreadableRequest(error)) return false;
  // P0001 è un messaggio scritto da noi dentro una funzione del database.
  if (!(error instanceof Error)) return field(error, "code") !== "P0001";
  if (["TypeError", "ReferenceError", "RangeError", "SyntaxError", "AbortError", "TimeoutError"].includes(error.name)) return true;
  return databaseMessages.has(error.message) || TECHNICAL.test(error.message);
}

/** Lo stesso guasto visto da più punti dell'app finisce in un avviso solo. */
export function sharedGroup(error: unknown): string | null {
  const message = rawMessage(error);
  // Database o rete che non rispondono: tanti errori diversi, un solo guasto.
  return databaseMessages.get(message)?.group ?? (UNREACHABLE.test(message) ? "database" : null);
}

export type UserError = { message: string; status: number; report: boolean };

export function describeForUser(error: unknown): UserError {
  const given = field(error, "status");
  const status = typeof given === "number" && given >= 400 && given <= 599 ? given : null;
  if (isUnreadableRequest(error)) return { message: UNREADABLE_REQUEST, status: 400, report: false };
  if (isTechnicalError(error)) return { message: SIMPLE_ERROR, status: status ?? 500, report: true };
  // Un messaggio scritto da noi si mostra com'è. Dal 500 in su avvisa, se non l'ha già fatto chi l'ha creato.
  const report = (status ?? 400) >= 500 && field(error, "reported") !== true;
  return { message: rawMessage(error) || SIMPLE_ERROR, status: status ?? 400, report };
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|POOLER_URL|CHAT_ID/;
const KEPT_QUOTE = /\b(relation|column|table|constraint|function|schema|type|policy|index|reading)\s*$/i;

function maskQuoted(text: string, pattern: RegExp) {
  return text.replace(pattern, (match: string, inner: string, offset: number, whole: string) => {
    // Restano solo i nomi tecnici (tabelle, colonne): tutto il resto tra virgolette può essere un dato di qualcuno.
    if (KEPT_QUOTE.test(whole.slice(0, offset)) && /^[A-Za-z0-9_.]{1,63}$/.test(inner)) return match;
    return "«…»";
  });
}

/** Toglie password, chiavi, indirizzi e dati personali da un testo tecnico. */
export function sanitizeDetail(text: string, env: Record<string, string | undefined> = process.env) {
  if (/<!doctype|<html/i.test(text)) return "Il server ha risposto con una pagina di errore.";
  let safe = text.slice(0, 2000);
  for (const [name, value] of Object.entries(env)) {
    if (!value || !SECRET_NAME.test(name)) continue;
    for (const part of [value, ...value.split(",")]) {
      if (part.trim().length >= 6) safe = safe.split(part.trim()).join("[nascosto]");
    }
  }
  safe = safe
    .replace(/Failing row contains \([\s\S]*/i, "Failing row contains (…)")
    .replace(/\)=\([\s\S]*\)/g, ")=(…)")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[indirizzo]")
    .replace(/[^\s<>()"'«»,;:=]+@[^\s<>()"'«»,;:]+/g, "[email]")
    .replace(/eyJ[\w-]+(\.[\w-]+){0,2}/g, "[chiave]")
    .replace(/\bbearer\s+\S+/gi, "Bearer [chiave]")
    .replace(/\b(password|passwd|pwd|token|secret|apikey|api_key|authorization|telefono|phone)(\s*[=:]\s*)("[^"]*"|[^\s,;]+)/gi, "$1$2[nascosto]")
    .replace(/(bot)?\d{6,}:[\w-]{20,}/gi, "[chiave]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{20,}\b/g, "[codice]");
  safe = maskQuoted(safe, /"([^"]*)"/g);
  safe = maskQuoted(safe, /(?<![\p{L}\d])'([^']*)'(?![\p{L}\d])/gu);
  safe = safe
    .replace(/«(?!…»)[^»]*»/g, "«…»")
    .replace(/“[^”]*”/g, "«…»")
    .replace(/\+?\d(?:[\s().-]?\d){6,}/g, "[numero]")
    .replace(/\s+/g, " ")
    .trim();
  return safe.length > 300 ? `${safe.slice(0, 300)}…` : safe;
}

export function errorDetail(error: unknown) {
  const name = error instanceof Error && error.name !== "Error" ? `${error.name}: ` : "";
  const code = field(error, "code");
  const suffix = typeof code === "string" && /^[A-Z0-9_]{2,12}$/.test(code) ? ` (codice ${code})` : "";
  const message = sanitizeDetail(rawMessage(error)) || "Errore senza dettaglio.";
  return `${name}${message}${suffix}`;
}
