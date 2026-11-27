import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logFake, onVercel, realExternalCallsAllowed, realNotificationsAllowed } = await import("@/lib/outbound");
  if (onVercel()) return;
  // Una riga all'avvio, così si vede subito se qualcosa può partire davvero.
  const state = (allowed: boolean) => (allowed ? "VERE (chiave aperta apposta)" : "finte");
  logFake("Avvio in locale", `notifiche ${state(realNotificationsAllowed())}, fonti esterne ${state(realExternalCallsAllowed())}. Il database resta quello di .env.local.`);
}

// Next chiama questa funzione per ogni errore del server che nessuno ha gestito.
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("@/lib/server/error-report");
    // routePath è il modello della pagina (/leghe/[leagueId]): non contiene codici di nessuno.
    const where = `${context.routeType === "route" ? "API" : "Schermata"} ${context.routePath}`;
    // Si aspetta l'invio, ma poco: se Telegram è lento la risposta non resta appesa.
    await Promise.race([reportError(where, error), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
};
