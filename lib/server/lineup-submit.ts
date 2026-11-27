// Salvataggio della formazione nel database (submit_lineup) con nuovi tentativi sui blocchi.
// Senza altri import: lo usano anche le prove senza database.

type RpcError = { code?: string; message: string };
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: RpcError | null }>;
};

/**
 * Codici Postgres di un salvataggio annullato per un blocco (stallo, conflitto, attesa troppo
 * lunga): il database ha annullato tutto, quindi si può ripetere da capo senza perdere niente.
 */
export const LINEUP_LOCK_CODES = new Set(["40P01", "40001", "55P03"]);
export const LINEUP_RETRY_DELAYS_MS = [60, 180];

/**
 * Chiama submit_lineup e, se il database l'ha annullata per un blocco con un altro salvataggio
 * della stessa squadra, la ripete fino a due volte. Ogni tentativo ricontrolla tutto nel
 * database, orario di inizio compreso: dopo la deadline il nuovo tentativo viene rifiutato.
 * Gli altri errori (rosa, modulo, giornata chiusa...) non si ripetono.
 */
export async function submitLineupSerialized(
  admin: RpcClient,
  args: Record<string, unknown>,
  delays: number[] = LINEUP_RETRY_DELAYS_MS,
): Promise<RpcError | null> {
  let { error } = await admin.rpc("submit_lineup", args);
  for (const delay of delays) {
    if (!error || !LINEUP_LOCK_CODES.has(error.code ?? "")) break;
    await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * delay));
    ({ error } = await admin.rpc("submit_lineup", args));
  }
  return error;
}
