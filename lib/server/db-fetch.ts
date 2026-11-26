import { reportError } from "@/lib/server/error-report";
import { rememberDatabaseMessage } from "@/lib/server/error-text";

// Ogni chiamata a Supabase passa di qui: così un guasto si vede anche dove il codice lo ignora.

// Classi di errore di Postgres e PostgREST che non sono mai un messaggio per chi usa l'app.
const TECHNICAL_CODE = /^(PGRST|08|0A|25|28|40|42|53|54|55|57|58|XX)/;

/** Solo il nome della tabella o del servizio: il resto dell'indirizzo può contenere dati. */
function area(input: RequestInfo | URL) {
  try {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "rest") return parts[2] === "rpc" ? `funzione ${parts[3]}` : `tabella ${parts[2]}`;
    if (parts[0] === "auth") return "accessi";
    if (parts[0] === "storage") return "file";
    return parts[0] ?? "servizio";
  } catch {
    return "servizio";
  }
}

async function inspect(input: RequestInfo | URL, response: Response, client: "server" | "session") {
  const place = area(input);
  const body = await response.clone().json().catch(() => null) as { message?: unknown; msg?: unknown; code?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message : typeof body?.msg === "string" ? body.msg : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const down = response.status >= 500;
  // Con la chiave del server un rifiuto vuol dire chiave o permessi sbagliati.
  const refused = client === "server" && place !== "accessi" && (response.status === 401 || response.status === 403);
  const isData = place.startsWith("tabella") || place.startsWith("funzione");
  const group = down ? "database" : refused ? `database-permessi ${place}` : null;
  if (group || (isData && TECHNICAL_CODE.test(code))) rememberDatabaseMessage(message, group);
  if (group) {
    void reportError(
      `Database, ${place}`,
      new Error(`Il database ha risposto ${response.status}. ${message}`.trim()),
      { kind: group },
    );
  }
}

export function reportingFetch(client: "server" | "session") {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      void reportError(`Database, ${area(input)}`, error, { kind: "database" });
      throw error;
    }
    if (!response.ok) await inspect(input, response, client);
    return response;
  };
}
