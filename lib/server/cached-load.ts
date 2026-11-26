import { AsyncLocalStorage } from "node:async_hooks";

// Segna le letture fatte per riempire la memoria condivisa. Lì dentro la memoria che raggruppa
// gli avvisi non funziona: l'errore si segnala al secondo tentativo, fuori dalla memoria.
export const cachedLoad = new AsyncLocalStorage<boolean>();
