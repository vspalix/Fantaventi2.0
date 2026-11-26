import { reportError } from "@/lib/server/error-report";
import {
  describeForUser,
  errorDetail,
  rememberDatabaseMessage,
  sanitizeDetail,
  sharedGroup,
  SIMPLE_ERROR,
  UNREADABLE_REQUEST,
} from "@/lib/server/error-text";

// Tutti i dati qui sotto sono inventati.
export async function runErrorReportChecks() {
  let passed = 0;
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    if (ok) passed += 1;
    else failures.push(detail ? `${name}: ${detail}` : name);
  };

  const hidden = (name: string, text: string, secrets: string[], env: Record<string, string> = {}) => {
    const safe = sanitizeDetail(text, env);
    check(name, secrets.every((secret) => !safe.includes(secret)), safe);
  };

  hidden("email nascosta", "Utente mario.rossi@example.com non trovato", ["mario.rossi", "example.com"]);
  hidden("password nascosta", "login password=segretissima rifiutato", ["segretissima"]);
  hidden("chiave JWT nascosta", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.firma rifiutato", ["eyJ"]);
  hidden("autorizzazione nascosta", "header Bearer abcDEF123 non valido", ["abcDEF123"]);
  hidden("token Telegram nascosto", "bot123456789:AAHfakefakefakefakefakefake12345 rifiutato", ["AAHfake", "123456789"]);
  hidden("identificativi nascosti", "id 3f2b8c1a-9d4e-4f6a-8b2c-1a9d4e4f6a8b", ["3f2b8c1a"]);
  hidden("telefono nascosto", "numero +39 333 123 4567 duplicato", ["333 123", "4567"]);
  hidden("valori di Postgres nascosti", 'duplicate key value violates unique constraint "profiles_email_key" Key (display_name)=(Mario Rossi) already exists.', ["Mario Rossi"]);
  hidden("riga intera nascosta", "new row violates check constraint. Failing row contains (7, Mario, Rossi).", ["Mario", "Rossi"]);
  hidden("nomi tra virgolette nascosti", "Squadra «I Campioni» di 'Mario' e \"Luigi\"", ["Campioni", "Mario", "Luigi"]);
  hidden("indirizzi nascosti", "GET https://esempio.test/rest?apikey=abc fallita", ["esempio.test", "apikey=abc"]);
  hidden("segreti del server nascosti", "errore con chiave-del-server dentro", ["chiave-del-server"], { SUPABASE_SERVICE_ROLE_KEY: "chiave-del-server" });
  check("il nome della tabella resta", sanitizeDetail('relation "player_registrations" does not exist', {}).includes("player_registrations"));
  check("una pagina HTML non finisce nell'avviso", !sanitizeDetail("<!DOCTYPE html><body>x</body>", {}).includes("<"));
  check("il testo è limitato", sanitizeDetail("parola ".repeat(200), {}).length <= 301);
  check("il codice del database resta", errorDetail(Object.assign(new Error("boom"), { code: "42P01" })).includes("42P01"));

  const technical = describeForUser(new Error('relation "players" does not exist'));
  check("errore del database: messaggio semplice e avviso", technical.message === SIMPLE_ERROR && technical.status === 500 && technical.report);
  const network = describeForUser(new Error("TypeError: fetch failed"));
  check("rete assente: messaggio semplice e avviso", network.message === SIMPLE_ERROR && network.report);
  const bug = describeForUser(new TypeError("Cannot read properties of undefined (reading 'id')"));
  check("errore del programma: messaggio semplice e avviso", bug.message === SIMPLE_ERROR && bug.report);
  const wrong = describeForUser(new Error("Inserisci il codice invito."));
  check("messaggio nostro: resta com'è, senza avviso", wrong.message === "Inserisci il codice invito." && wrong.status === 400 && !wrong.report);
  const login = describeForUser(Object.assign(new Error("Accesso richiesto."), { status: 401 }));
  check("accesso mancante: nessun avviso", login.status === 401 && !login.report);
  const setup = describeForUser(Object.assign(new Error("Manca la tabella. Esegui app_announcements.sql."), { status: 503 }));
  check("nostro errore 503: messaggio e avviso", setup.message.startsWith("Manca la tabella") && setup.report);
  const unreadable = describeForUser(new SyntaxError("Unexpected end of JSON input"));
  check("richiesta spezzata: nessun avviso", unreadable.message === UNREADABLE_REQUEST && unreadable.status === 400 && !unreadable.report);
  check("regola del database: resta com'è", describeForUser({ code: "P0001", message: "La giornata è chiusa." }).message === "La giornata è chiusa.");
  rememberDatabaseMessage("guasto senza parole note", "database");
  const remembered = describeForUser(new Error("guasto senza parole note"));
  check("un messaggio arrivato dal database non si mostra", remembered.message === SIMPLE_ERROR && remembered.report);
  check("guasti di rete raggruppati insieme", sharedGroup(new Error("TypeError: fetch failed")) === "database" && sharedGroup(new Error("guasto senza parole note")) === "database");
  check("un errore di programma ha il suo gruppo", sharedGroup(new TypeError("x is not a function")) === null);

  // Fuori dal sito (compilazione e verifiche) non deve partire niente verso Telegram.
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  console.error = () => undefined;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}");
  }) as typeof fetch;
  try {
    const outcome = await reportError("Verifica", new Error("prova"));
    check("fuori dal sito nessun avviso", outcome === "ignored" && calls === 0, `${outcome}, chiamate ${calls}`);
  } finally {
    console.error = originalError;
    globalThis.fetch = originalFetch;
  }

  return { passed, total: passed + failures.length, failures };
}
