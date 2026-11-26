import { revalidateTag, unstable_cache } from "next/cache";

// Memoria condivisa tra tutte le visite e tutti gli utenti.
// Va usata SOLO per dati uguali per tutti: niente utente, cookie o permessi dentro le letture.

export const SHARED_TAGS = {
  brand: "shared:brand",
  clubBadges: "shared:club-badges",
  maintenance: "shared:maintenance",
  seasons: "shared:seasons",
} as const;

type SharedTag = (typeof SHARED_TAGS)[keyof typeof SHARED_TAGS];

/**
 * La lettura resta in memoria finché l'app non chiama forgetShared, oppure per `seconds` secondi.
 * La scadenza copre le modifiche fatte a mano su Supabase, di cui l'app non viene avvisata.
 * `load` deve lanciare un errore quando la lettura fallisce, così il fallimento non viene memorizzato.
 */
export function shared<T>(tag: SharedTag, seconds: number, load: () => Promise<T>) {
  const cached = unstable_cache(load, [tag], { tags: [tag], revalidate: seconds });
  return async (): Promise<T> => {
    try {
      return await cached();
    } catch {
      // Fuori da Next (script da terminale), o se la memoria rifiuta il dato, si legge dal database.
      return load();
    }
  };
}

/** Da chiamare subito dopo un salvataggio, da una route API. */
export function forgetShared(tag: SharedTag) {
  try {
    revalidateTag(tag);
  } catch (error) {
    // Il dato è già salvato: al massimo si aggiorna alla scadenza.
    console.warn(`Memoria condivisa non svuotata (${tag}):`, error instanceof Error ? error.message : error);
  }
}
