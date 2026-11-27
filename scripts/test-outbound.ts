// Niente invii veri in locale: sul PC notifiche e chiamate esterne sono finte, sul sito restano vere.
// La rete è sostituita fin dall'inizio: anche se un blocco si rompesse, da qui non parte niente.
// Va eseguita in un processo a parte (vedi ci-engine-suite.ts), perché cambia variabili e piattaforma.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FAKE_NOTICE,
  onVercel,
  realExternalCallsAllowed,
  realJobsAllowed,
  realNotificationsAllowed,
} from "../lib/outbound";
import { removeSendingKeys, testMayContact } from "./test-guard";

type Case = { name: string; pass: boolean; detail: string };
type Sent = { method: string; url: string };

const VARIABLES = [
  "ALLOW_REAL_NOTIFICATIONS", "ALLOW_REAL_EXTERNAL_CALLS", "VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "RESEND_FROM",
  "API_FOOTBALL_KEY", "CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
];

export async function runOutboundChecks() {
  const cases: Case[] = [];
  const add = (name: string, pass: boolean, detail = "") => cases.push({ name, pass, detail });

  const saved = new Map(VARIABLES.map((name) => [name, process.env[name]]));
  const realPlatform = process.platform;
  const realFetch = globalThis.fetch;
  const realGet = https.get;
  const realRequest = https.request;
  const realInfo = console.info;
  const realError = console.error;

  const sent: Sent[] = [];
  const log: string[] = [];
  let directCalls = 0;
  const refuse = (() => {
    directCalls += 1;
    throw new Error("rete bloccata nella prova");
  }) as unknown;

  for (const name of VARIABLES) delete process.env[name];
  // Chiavi inventate: così il blocco è l'unica cosa che ferma l'invio.
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: "123456:token-finto-di-prova",
    TELEGRAM_CHAT_ID: "999000",
    VAPID_PUBLIC_KEY: "chiave-finta",
    VAPID_PRIVATE_KEY: "chiave-finta",
    RESEND_API_KEY: "chiave-finta",
    RESEND_FROM: "prova@example.test",
    API_FOOTBALL_KEY: "chiave-finta",
    CRON_SECRET: "segreto-finto",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_SERVICE_ROLE_KEY: "service-finta",
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push({ method: init?.method ?? "GET", url });
    if (url.startsWith("http://127.0.0.1:9/")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://api.telegram.org/")) return new Response('{"ok":true}', { status: 200 });
    return new Response("", { status: 500 });
  }) as typeof fetch;
  https.get = refuse as typeof https.get;
  https.request = refuse as typeof https.request;
  console.info = (...parts: unknown[]) => void log.push(parts.join(" "));
  console.error = (...parts: unknown[]) => void log.push(parts.join(" "));

  const reset = () => {
    sent.length = 0;
    log.length = 0;
    directCalls = 0;
  };
  const failure = async (task: () => Promise<unknown>) => {
    try {
      await task();
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : "errore";
    }
  };
  const asVercel = async (task: () => Promise<void>) => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    Object.assign(process.env, { VERCEL: "1", VERCEL_ENV: "production" });
    try {
      await task();
    } finally {
      Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
    }
  };

  try {
    // 1. Dove ci troviamo.
    const pulled = { VERCEL: "1", VERCEL_ENV: "production", AWS_LAMBDA_FUNCTION_NAME: "x" };
    add("PC Windows: finto anche con le variabili di Vercel in .env.local", !onVercel(pulled, "win32") && !realNotificationsAllowed(pulled, "win32"));
    add("Mac: finto", !onVercel(pulled, "darwin"));
    add("Sito su Vercel: vero", onVercel({ VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" }, "linux"));
    add("Anteprima su Vercel: vero come prima", realNotificationsAllowed({ VERCEL: "1", VERCEL_ENV: "preview" }, "linux"));
    add("Sito che non espone le variabili di Vercel: vero lo stesso", realNotificationsAllowed({ NODE_ENV: "production", AWS_LAMBDA_FUNCTION_NAME: "funzione" }, "linux"));
    add("npm run dev su Linux: finto", !onVercel({ VERCEL: "1", NODE_ENV: "development" }, "linux"));
    add("vercel dev: finto", !onVercel({ VERCEL: "1", VERCEL_ENV: "development" }, "linux"));
    add("GitHub e altri computer Linux: finto", !onVercel({ NODE_ENV: "production" }, "linux") && !onVercel({}, "linux"));

    // 2. Le due chiavi.
    const onlyNotices = { ALLOW_REAL_NOTIFICATIONS: "true" };
    const onlySources = { ALLOW_REAL_EXTERNAL_CALLS: "true" };
    add("Senza chiavi in locale è tutto finto", !realNotificationsAllowed({}, "win32") && !realExternalCallsAllowed({}, "win32"));
    add("La chiave delle notifiche apre solo le notifiche", realNotificationsAllowed(onlyNotices, "win32") && !realExternalCallsAllowed(onlyNotices, "win32"));
    add("La chiave delle fonti apre solo le fonti", realExternalCallsAllowed(onlySources, "win32") && !realNotificationsAllowed(onlySources, "win32"));
    add("Solo «true» apre: 1, si e false no", ["1", "si", "false", "", "vero"].every((value) => !realNotificationsAllowed({ ALLOW_REAL_NOTIFICATIONS: value }, "win32")));
    add("I giri automatici chiedono tutte e due", !realJobsAllowed(onlyNotices, "win32") && !realJobsAllowed(onlySources, "win32") && realJobsAllowed({ ...onlyNotices, ...onlySources }, "win32"));

    // 3. Telegram.
    const { sendTelegramMessage, sendSyncTestAlert, alertAppError } = await import("../lib/server/telegram-alert");
    reset();
    const fake = await sendTelegramMessage("<b>Prova</b> Rossi &amp; Verdi");
    add("Telegram in locale: nessuna richiesta", sent.length === 0 && directCalls === 0, `${sent.length}`);
    add("Telegram in locale: il chiamante sa che non è partito", !fake.sent && fake.reason === FAKE_NOTICE, JSON.stringify(fake));
    const line = log.join("\n");
    add("Telegram in locale: il messaggio è nel registro", line.includes("[finto] Telegram") && line.includes("Prova Rossi & Verdi"), line);
    add("Nel registro non finiscono chiave e chat", !line.includes("token-finto") && !line.includes("999000"), line);
    reset();
    await sendSyncTestAlert();
    await alertAppError({ where: "Prova", detail: "errore", repeats: 0 });
    add("Messaggio di prova e avviso di errore sono finti", sent.length === 0 && log.filter((item) => item.includes("[finto] Telegram")).length === 2, `${sent.length}`);

    await asVercel(async () => {
      reset();
      const real = await sendTelegramMessage("controllo");
      add("Sul sito Telegram parte come prima", real.sent && sent.length === 1 && sent[0].url.startsWith("https://api.telegram.org/bot") && sent[0].method === "POST", `${sent.length}`);
    });
    reset();
    process.env.ALLOW_REAL_NOTIFICATIONS = "true";
    const opened = await sendTelegramMessage("controllo");
    delete process.env.ALLOW_REAL_NOTIFICATIONS;
    add("Con la chiave aperta apposta Telegram parte anche dal PC", opened.sent && sent.length === 1, `${sent.length}`);

    // 4. Notifiche ai telefoni, messaggi agli utenti.
    const { sendPushToUsers, sendPushToEveryone } = await import("../lib/server/web-push");
    const untouchable = new Proxy({}, { get: () => { throw new Error("il database non va toccato"); } }) as never;
    reset();
    const pushed = await sendPushToUsers(["u1", "u2"], { title: "Formazione", body: "Manca poco" }, untouchable);
    const everyone = await sendPushToEveryone({ title: "Ciao", body: "A tutti" });
    add("Notifiche ai telefoni in locale: niente invio e niente database", pushed.sent === 0 && everyone.sent === 0 && sent.length === 0 && directCalls === 0, `${sent.length}/${directCalls}`);
    add("Notifiche ai telefoni nel registro", log.filter((item) => item.includes("[finto] Notifica")).length === 2, log.join(" / "));

    const { sendBroadcast } = await import("../lib/server/broadcast");
    reset();
    const broadcast = await failure(() => sendBroadcast({ subject: "Avviso", message: "Testo", leagueId: null, inbox: true, email: true, testUserId: null, testEmail: null }));
    add("Messaggio agli utenti (app ed email): bloccato prima del database", broadcast === FAKE_NOTICE && sent.length === 0, `${broadcast} ${sent.length}`);

    // 5. Promemoria e avvisi di partita: nessun segno «già inviato» nel database.
    const { runLineupReminderSafely } = await import("../lib/server/lineup-reminder");
    reset();
    const reminder = await runLineupReminderSafely(Date.now());
    add("Promemoria formazioni in locale: non tocca il database", reminder === null && sent.length === 0 && log.some((item) => item.includes("[finto] Promemoria")), `${sent.length} ${log.join(" / ")}`);

    const { runEngagementTick } = await import("../lib/server/engagement-tick");
    reset();
    const tick = await runEngagementTick(new Date());
    add(
      "Avvisi di partita in locale: nessun testo letto e nessun «già inviato»",
      tick.sent === 0 && !sent.some((item) => /notification_templates|engagement_notices|push_subscriptions|live_rank_snapshots/.test(item.url)),
      sent.map((item) => `${item.method} ${item.url}`).join(" "),
    );
    reset();
    process.env.ALLOW_REAL_NOTIFICATIONS = "true";
    await runEngagementTick(new Date());
    delete process.env.ALLOW_REAL_NOTIFICATIONS;
    add("Controprova: con la chiave aperta gli avvisi di partita si eseguono", sent.some((item) => item.url.includes("notification_templates")), `${sent.length}`);

    // 6. Fonti esterne.
    const { fetchSkyCalendar } = await import("../lib/server/sky-calendar");
    const { fetchFantacalcioMatchweek } = await import("../lib/server/fantacalcio-live");
    const { fantacalcioAvailabilityProvider } = await import("../lib/availability-providers/fantacalcio");
    const { apiFootballProvider } = await import("../lib/availability-providers/api-football");
    const { externalJsonProvider } = await import("../lib/availability-providers/external-json");
    const context = { leagueId: 135, season: 2026, jsonUrl: "https://fonte.invalid/dati.json" };
    const sources: [string, () => Promise<unknown>][] = [
      ["Calendario di Sky", () => fetchSkyCalendar()],
      ["Voti di Fantacalcio", () => fetchFantacalcioMatchweek("2026-27", 13)],
      ["Indisponibili di Fantacalcio", () => fantacalcioAvailabilityProvider.load(context)],
      ["API-Football", () => apiFootballProvider.load(context)],
      ["Indisponibili da JSON esterno", () => externalJsonProvider.load(context)],
    ];
    for (const [name, load] of sources) {
      reset();
      const message = await failure(load);
      add(`${name}: bloccata in locale`, message.includes("bloccate") && sent.length === 0 && directCalls === 0, `${message} ${sent.length}/${directCalls}`);
    }
    reset();
    process.env.ALLOW_REAL_EXTERNAL_CALLS = "true";
    await failure(() => fetchSkyCalendar());
    delete process.env.ALLOW_REAL_EXTERNAL_CALLS;
    add("Controprova: con la chiave aperta la fonte viene contattata", sent.length === 1 && sent[0].url.startsWith("https://sport.sky.it/"), `${sent.length}`);

    // 7. Giri automatici.
    const votes = await import("../lib/server/sync-match-votes");
    const { refreshSerieAKickoffs } = await import("../lib/server/kickoff-refresh");
    const { syncAvailability } = await import("../lib/server/availability");
    reset();
    const planned = await votes.runPlannedReads({} as never, {} as never);
    const manual = await failure(() => votes.syncDueMatchVotes());
    const calendar = await failure(() => refreshSerieAKickoffs({ force: true }));
    const availability = await failure(() => syncAvailability(true));
    add("Voti, calendario e indisponibili in locale non toccano il database", sent.length === 0 && directCalls === 0, sent.map((item) => item.url).join(" "));
    add("Le letture programmate restano vuote, senza errori", planned.reads.length === 0 && planned.errors.length === 0);
    add("Chi li avvia a mano legge perché non partono", [manual, calendar, availability].every((message) => message.includes("in locale non si esegue")), [manual, calendar, availability].join(" / "));

    const request = (url: string, body?: unknown) => new Request(url, {
      method: "POST",
      headers: { authorization: "Bearer segreto-finto" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const availabilityRoute = await import("../app/api/cron/sync-availability/route");
    const votesRoute = await import("../app/api/cron/sync-match-votes/route");
    reset();
    const first = await availabilityRoute.POST(request("http://localhost/api/cron/sync-availability", { force: true }));
    const second = await votesRoute.POST(request("http://localhost/api/cron/sync-match-votes", { force: true }));
    const firstBody = await first.json() as { skipped?: boolean };
    add("Sveglia indisponibili in locale: saltata", first.status === 200 && firstBody.skipped === true, `${first.status}`);
    add("Forza voti in locale: rifiutato con spiegazione", second.status === 409, `${second.status}`);
    add("Le due sveglie in locale non scrivono nel registro sincronizzazioni", sent.length === 0, sent.map((item) => `${item.method} ${item.url}`).join(" "));
  } finally {
    globalThis.fetch = realFetch;
    https.get = realGet;
    https.request = realRequest;
    console.info = realInfo;
    console.error = realError;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  // 8. Script lanciati a mano. L'indirizzo .invalid non esiste: se il blocco si rompesse non arriverebbe a nessuno.
  const script = (args: string[], extra: Record<string, string> = {}) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    removeSendingKeys(env);
    for (const name of Object.keys(env)) if (/SUPABASE/.test(name)) delete env[name];
    const run = spawnSync(process.execPath, args, { env: { ...env, ...extra }, encoding: "utf8", timeout: 60_000 });
    return { status: run.status, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
  };
  const cron = script([path.join("scripts", "test-cron.js")], { APP_URL: "https://sito.invalid", CRON_SECRET: "finto" });
  add("test-cron.js non sveglia il sito", cron.status === 0 && cron.output.includes("[finto]"), cron.output.slice(0, 200));
  const shift = script([path.join("scripts", "shift-deadlines.mjs")]);
  add("shift-deadlines.mjs non scrive nel database", shift.status === 0 && shift.output.includes("[finto]"), shift.output.slice(0, 200));
  const backfill = script(["--import", "tsx", path.join("scripts", "backfill-early-weeks.ts")]);
  add("backfill-early-weeks.ts non scrive nel database", backfill.status === 0 && backfill.output.includes("[finto]"), backfill.output.slice(0, 200));

  // 9. Protezione delle verifiche.
  const keys: Record<string, string> = { TELEGRAM_BOT_TOKEN: "x", VAPID_PRIVATE_KEY: "x", ALLOW_REAL_NOTIFICATIONS: "true", CRON_SECRET: "x", NEXT_PUBLIC_SUPABASE_URL: "x" };
  removeSendingKeys(keys);
  add("Le verifiche tolgono le chiavi di invio e tengono il database", Object.keys(keys).join(",") === "NEXT_PUBLIC_SUPABASE_URL", Object.keys(keys).join(","));
  add(
    "Le verifiche possono contattare solo il PC e il database",
    testMayContact("http://127.0.0.1:5/x", undefined)
      && testMayContact("https://abc.supabase.co/rest", "https://abc.supabase.co")
      && !testMayContact("https://api.telegram.org/bot", "https://abc.supabase.co")
      && !testMayContact("https://fantaventi2-0.vercel.app/api", undefined),
  );

  // 10. Nessuna nuova chiamata esterna senza blocco.
  const files = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? files(full) : /\.tsx?$/.test(entry.name) ? [full] : [];
  });
  const unguarded = ["lib/server", "lib/availability-providers", "app/api"].flatMap(files).filter((file) => {
    if (file.endsWith("db-fetch.ts")) return false; // il database
    const source = readFileSync(file, "utf8");
    return /\bfetch\(|https?\.(get|request)\(|\.sendNotification\(/.test(source) && !source.includes('from "@/lib/outbound"');
  });
  add("Ogni file del server che chiama l'esterno passa da lib/outbound.ts", unguarded.length === 0, unguarded.join(", "));

  const failures = cases.filter((item) => !item.pass).map((item) => `${item.name}: ${item.detail}`);
  return { passed: cases.length - failures.length, total: cases.length, failures, cases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runOutboundChecks().then((result) => {
    for (const item of result.failures) console.log(`- ${item.replace(/\r?\n/g, " ")}`);
    console.log(`${result.failures.length === 0 ? "PASSED" : "FAILED"} ${result.passed}/${result.total}`);
    // Alcune librerie lasciano timer aperti: la prova è finita.
    process.exit(result.failures.length === 0 ? 0 : 1);
  });
}
