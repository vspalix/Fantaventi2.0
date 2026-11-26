import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { cachedLoad } from "@/lib/server/cached-load";
import { errorDetail, isFrameworkSignal, isTechnicalError, sanitizeDetail, sharedGroup } from "@/lib/server/error-text";

// Punto unico per gli errori: li scrive nel registro e avvisa su Telegram, al massimo una volta
// all'ora per tipo. Non lancia mai e non fa aspettare chi usa l'app. Non usa il database.

/** Dove un rifiuto è normale (per esempio la fonte che non ha ancora i voti) si segnalano solo i guasti. */
export function reportIfTechnical(where: string, error: unknown) {
  if (isTechnicalError(error)) void reportError(where, error);
}

/** Per le parti facoltative: una tabella mai creata non è un guasto da segnalare. */
export function reportUnlessMissing(where: string, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/schema cache|does not exist|could not find/i.test(message)) return;
  void reportError(where, error);
}

export type ReportOutcome = "sent" | "grouped" | "failed" | "ignored";

const HOUR = 60 * 60 * 1000;
const MAX_ALERTS_PER_HOUR = 20;

const groups = new Map<string, { sentAt: number; repeats: number }>();
let recent: number[] = [];

function trace(error: unknown) {
  const stack = error instanceof Error ? error.stack ?? "" : "";
  return stack
    .split("\n")
    .filter((line) => line.trim().startsWith("at "))
    .slice(0, 5)
    .map((line) => `    at ${line.trim().slice(3).split(/[\\/]/).slice(-3).join("/")}`)
    .join("\n");
}

/** La stessa memoria condivisa del sito vale per tutte le copie dell'app: chi arriva secondo tace. */
async function claimHour(kind: string) {
  const id = randomUUID();
  try {
    const claim = unstable_cache(async () => ({ id, at: Date.now() }), ["error-alert", kind], { revalidate: HOUR / 1000 });
    const marker = await claim();
    return marker.id === id || Date.now() - marker.at >= HOUR;
  } catch {
    // Fuori da Next resta il raggruppamento in memoria.
    return true;
  }
}

async function deliver(kind: string, where: string, detail: string, repeats: number): Promise<ReportOutcome> {
  try {
    if (!(await claimHour(kind))) return "grouped";
    const { alertAppError } = await import("@/lib/server/telegram-alert");
    const result = await alertAppError({ where, detail, repeats });
    return result.sent ? "sent" : "failed";
  } catch {
    console.info("Alert Telegram non inviato: avviso errore non riuscito.");
    return "failed";
  }
}

export function reportError(where: string, error: unknown, options: { kind?: string } = {}): Promise<ReportOutcome> {
  try {
    if (isFrameworkSignal(error)) return Promise.resolve("ignored");
    const place = sanitizeDetail(where);
    const detail = errorDetail(error);
    console.error([`[errore] ${new Date().toISOString()} | ${place} | ${detail}`, trace(error)].filter(Boolean).join("\n"));
    // Verifiche da terminale e compilazione scrivono nel registro e basta.
    const serving = process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build";
    if (!serving || cachedLoad.getStore()) return Promise.resolve("ignored");

    const kind = options.kind ?? sharedGroup(error) ?? `${place}|${detail.toLowerCase().replace(/\d+/g, "#")}`;
    const now = Date.now();
    const known = groups.get(kind);
    recent = recent.filter((at) => now - at < HOUR);
    if ((known && now - known.sentAt < HOUR) || recent.length >= MAX_ALERTS_PER_HOUR) {
      if (known) known.repeats += 1;
      return Promise.resolve("grouped");
    }
    recent.push(now);
    groups.set(kind, { sentAt: now, repeats: 0 });
    if (groups.size > 200) groups.delete(groups.keys().next().value as string);

    const task = deliver(kind, place, detail, known?.repeats ?? 0);
    try {
      // L'invio continua dopo la risposta, senza rallentare la pagina.
      after(task);
    } catch {
      // Fuori da una richiesta l'invio prosegue da solo.
    }
    return task;
  } catch {
    return Promise.resolve("failed");
  }
}
