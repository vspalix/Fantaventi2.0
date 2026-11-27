// Regole delle notifiche web senza dipendenze: contatto VAPID e lettura dei rifiuti.

const SITE_CONTACT = "https://fantaventi2-0.vercel.app";

/** Apple rifiuta (403 BadJwtToken) un contatto inventato: in quel caso si usa l'indirizzo del sito. */
export function vapidContact(raw: string | undefined) {
  const value = (raw ?? "").trim().replace(/^mailto:\s*<?([^<>\s]+)>?$/i, "mailto:$1");
  const mail = /^mailto:[^@\s<>]+@([^@\s<>]+\.[a-z]{2,})$/i.exec(value)?.[1];
  const web = /^https:\/\/([^/\s]+\.[a-z]{2,})(\/\S*)?$/i.exec(value)?.[1];
  const host = mail ?? web;
  return host && !/(^|\.)(local|localhost|test|invalid|example|example\.(com|org|net))$/i.test(host) ? value : SITE_CONTACT;
}

function pushService(endpoint: string) {
  const host = URL.canParse(endpoint) ? new URL(endpoint).hostname : "";
  if (host.endsWith("push.apple.com")) return "Apple (iPhone, iPad o Safari)";
  if (host.endsWith("googleapis.com")) return "Google (Android o Chrome)";
  if (host.endsWith("mozilla.com")) return "Mozilla (Firefox)";
  if (host.endsWith("windows.com")) return "Microsoft (Edge)";
  return "servizio sconosciuto";
}

/** Solo la parola con cui il servizio spiega il rifiuto: mai l'indirizzo del dispositivo né chiavi. */
function pushReason(body: unknown) {
  const text = typeof body === "string" ? body.trim() : "";
  let reason = text;
  try {
    const parsed = JSON.parse(text) as { reason?: unknown; message?: unknown; error?: unknown };
    reason = String(parsed.reason ?? parsed.message ?? parsed.error ?? "");
  } catch {
    // Alcuni servizi rispondono con testo semplice.
  }
  return reason.replace(/https?:\/\/\S+/g, "").replace(/[A-Za-z0-9_\-+/=]{32,}/g, "…").replace(/\s+/g, " ").slice(0, 120).trim() || "non indicato";
}

export function pushFailure(endpoint: string, error: unknown) {
  const { statusCode, body, code } = (error ?? {}) as { statusCode?: number; body?: unknown; code?: string };
  const reason = statusCode ? pushReason(body) : (code ?? "nessuna risposta");
  // Iscrizione da buttare: scaduta, token non riconosciuto o creata con un'altra chiave.
  const gone = statusCode === 404 || statusCode === 410
    || (statusCode === 400 && /BadDeviceToken|BadWebPushToken/i.test(reason))
    || ((statusCode === 400 || statusCode === 403) && /VapidPkHashMismatch|do(es)? not correspond/i.test(reason));
  const summary = `codice ${statusCode ?? "assente"}, motivo ${reason}, servizio ${pushService(endpoint)}${gone ? ", iscrizione eliminata" : ""}`;
  return { gone, summary };
}
