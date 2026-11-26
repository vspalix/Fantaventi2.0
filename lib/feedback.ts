export function readableError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message.trim() : "";
  const text = message.toLowerCase();
  if (
    !message
    || text.includes("failed to fetch")
    || text.includes("networkerror")
    || text.includes("network request failed")
    || text.includes("load failed")
  ) {
    return "Connessione assente. Resta su questa schermata, controlla la rete e riprova.";
  }
  if (text.includes("unexpected token") || text.includes("not valid json")) {
    return "Il server non ha risposto in modo leggibile. Resta qui e riprova tra poco.";
  }
  // Un errore interno del programma non si mostra com'è.
  if (reason instanceof TypeError || reason instanceof ReferenceError) return fallback;
  return message || fallback;
}

export async function readAction<T>(response: Response): Promise<T> {
  let body: T & { error?: string };
  try {
    body = (await response.json()) as T & { error?: string };
  } catch {
    throw new Error("Il server non ha risposto in modo leggibile. Resta qui e riprova tra poco.");
  }
  if (!response.ok) {
    throw new Error(body.error ?? "Operazione non riuscita. Controlla i dati e riprova da questa schermata.");
  }
  return body;
}
