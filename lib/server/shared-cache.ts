import { revalidateTag, unstable_cache } from "next/cache";
import { cachedLoad } from "@/lib/server/cached-load";
import { reportError } from "@/lib/server/error-report";

// Memoria condivisa tra tutte le visite e tutti gli utenti.
// Va usata SOLO per dati uguali per tutti: niente utente, cookie o permessi dentro le letture.

export const SHARED_TAGS = {
  announcements: "shared:announcements",
  brand: "shared:brand",
  clubBadges: "shared:club-badges",
  listone: "shared:listone",
  maintenance: "shared:maintenance",
  seasons: "shared:seasons",
} as const;

type SharedTag = (typeof SHARED_TAGS)[keyof typeof SHARED_TAGS];

/**
 * La lettura resta in memoria finché l'app non chiama forgetShared, oppure per `seconds` secondi.
 * La scadenza copre le modifiche fatte a mano su Supabase, di cui l'app non viene avvisata.
 * `load` deve lanciare un errore quando la lettura fallisce, così il fallimento non viene memorizzato.
 * Gli eventuali argomenti di `load` tengono separate le copie (per esempio una per stagione).
 */
export function shared<A extends string[], T>(tag: SharedTag, seconds: number, load: (...args: A) => Promise<T>) {
  const remembered = (...args: A) => cachedLoad.run(true, () => load(...args));
  const cached = unstable_cache(remembered, [tag], { tags: [tag], revalidate: seconds });
  return async (...args: A): Promise<T> => {
    try {
      return await cached(...args);
    } catch {
      // Fuori da Next (script da terminale), o se la memoria rifiuta il dato, si legge dal database.
      return load(...args);
    }
  };
}

/** Da chiamare subito dopo un salvataggio, da una route API. */
export function forgetShared(tag: SharedTag) {
  try {
    revalidateTag(tag);
  } catch (error) {
    // Il dato è già salvato: al massimo si aggiorna alla scadenza.
    void reportError(`Memoria condivisa non svuotata (${tag})`, error);
  }
}
