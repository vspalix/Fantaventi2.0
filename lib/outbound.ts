// Tutto ciò che esce dall'app (notifiche, email, fonti esterne) parte davvero solo sul sito in Vercel.
// Sul PC, nelle verifiche e negli script è finto: si scrive nel registro e basta.
// Il database (Supabase) non passa di qui: senza, l'app in locale non si apre.

/** Apre le notifiche vere (Telegram, notifiche ai telefoni, email) fuori dal sito. */
export const NOTIFICATIONS_SWITCH = "ALLOW_REAL_NOTIFICATIONS";
/** Apre le chiamate vere alle fonti esterne (voti, calendario, indisponibili) fuori dal sito. */
export const SOURCES_SWITCH = "ALLOW_REAL_EXTERNAL_CALLS";

export const FAKE_NOTICE = "In locale l'invio è finto: non è partito niente. Il messaggio è scritto nel registro.";

type Env = Record<string, string | undefined>;

/** Vero solo per l'app in esecuzione su Vercel (sito e anteprime). */
export function onVercel(env: Env = process.env, platform: string = process.platform) {
  // Un .env.local scaricato da Vercel può contenere le sue variabili: da sole non bastano.
  // Vercel gira su Linux, il PC di lavoro su Windows.
  if (platform !== "linux") return false;
  if (env.NODE_ENV === "development" || env.VERCEL_ENV === "development") return false;
  return env.VERCEL === "1"
    || env.VERCEL_ENV === "production"
    || env.VERCEL_ENV === "preview"
    // Presente nelle funzioni del sito anche se il progetto non espone le variabili di Vercel.
    || Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
}

function switchedOn(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function realNotificationsAllowed(env: Env = process.env, platform: string = process.platform) {
  return onVercel(env, platform) || switchedOn(env[NOTIFICATIONS_SWITCH]);
}

export function realExternalCallsAllowed(env: Env = process.env, platform: string = process.platform) {
  return onVercel(env, platform) || switchedOn(env[SOURCES_SWITCH]);
}

/**
 * I giri automatici segnano nel database «già fatto» o «già avvisato». Eseguiti a metà sul PC,
 * il sito li salterebbe: partono solo con tutte e due le chiavi aperte.
 */
export function realJobsAllowed(env: Env = process.env, platform: string = process.platform) {
  return realNotificationsAllowed(env, platform) && realExternalCallsAllowed(env, platform);
}

/** Intestazione della risposta della sveglia rifiutata: «veri» solo se tutto parte davvero. */
export const DELIVERY_HEADER = "x-fantaventi-invii";

export function deliveryState(env: Env = process.env, platform: string = process.platform) {
  return realJobsAllowed(env, platform) ? "veri" : "finti";
}

/** La riga del registro che prende il posto di un invio o di una chiamata. */
export function logFake(channel: string, detail: string) {
  console.info(`[finto] ${channel}: ${detail}`);
}

function blocked(message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = 409;
  return error;
}

/** Da chiamare subito prima di contattare una fonte esterna. */
export function assertExternalCall(what: string) {
  if (realExternalCallsAllowed()) return;
  logFake(what, "chiamata esterna bloccata");
  throw blocked(`In locale le chiamate esterne sono bloccate (${what}). Non è partito niente.`);
}

export function skippedJobReason(what: string) {
  return `${what}: in locale non si esegue, per non segnare nel database cose mai inviate.`;
}

export function logSkippedJob(what: string) {
  console.info(`[finto] ${skippedJobReason(what)}`);
}

/** Da chiamare prima di un giro automatico, prima di qualunque lettura o scrittura. */
export function assertRealJobs(what: string) {
  if (realJobsAllowed()) return;
  logFake(what, "giro automatico non eseguito");
  throw blocked(skippedJobReason(what));
}
