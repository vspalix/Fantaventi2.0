// Protezione delle verifiche: niente chiavi di invio e niente rete, tranne il PC e il database
// configurato. Le prove che hanno bisogno di rete la sostituiscono con una finta.

/** Variabili che permettono di spedire qualcosa o di contattare un servizio a pagamento. */
const SENDING_KEYS = /^(TELEGRAM_|VAPID_|RESEND_|API_FOOTBALL_|CRON_SECRET$|ALLOW_REAL_)/;

export function removeSendingKeys(env: Record<string, string | undefined> = process.env) {
  for (const name of Object.keys(env)) {
    if (SENDING_KEYS.test(name)) delete env[name];
  }
}

export function testMayContact(url: string, databaseUrl: string | undefined) {
  try {
    const host = new URL(url).hostname;
    if (host === "127.0.0.1" || host === "localhost" || host === "[::1]") return true;
    return Boolean(databaseUrl) && host === new URL(databaseUrl as string).hostname;
  } catch {
    return false;
  }
}

export function installTestNetworkGuard() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!testMayContact(url, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      return Promise.reject(new Error("Nelle verifiche la rete esterna è bloccata."));
    }
    return realFetch(input, init);
  }) as typeof fetch;
}
