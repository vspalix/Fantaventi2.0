// Supabase restituisce al massimo 1000 righe per richiesta e taglia il resto senza errori:
// le letture che possono superarle (più giornate, più squadre) vanno fatte a pagine.

export const PAGE_ROWS = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** `page` deve ordinare in modo stabile (per chiave), altrimenti tra le pagine le righe si perdono. */
export async function readAllRows<T>(page: (from: number, to: number) => Page<T>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_ROWS) return { data: rows, error: null };
  }
}

/** Elenchi lunghi di codici a blocchi: tutti insieme l'indirizzo della richiesta diventa troppo lungo. */
export function inChunks<T>(items: T[], size = 100) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

/** Una lettura filtrata per un elenco lungo di codici: a blocchi, e ogni blocco a pagine. */
export async function readAllChunks<T>(ids: string[], page: (chunk: string[], from: number, to: number) => Page<T>) {
  const parts = await Promise.all(inChunks(ids).map((chunk) => readAllRows<T>((from, to) => page(chunk, from, to))));
  return { data: parts.flatMap((part) => part.data), error: parts.find((part) => part.error)?.error ?? null };
}
