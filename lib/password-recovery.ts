/**
 * Cosa porta con sé l'indirizzo di /accesso/nuova-password.
 * Il codice del link creato dall'admin sta dopo il #, così non finisce nei registri del server.
 */
export type RecoveryAddress =
  | { kind: "token"; tokenHash: string }
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "code" }
  | { kind: "error" }
  | { kind: "none" };

export const EXPIRED_LINK = "Il link è scaduto o è già stato usato. Chiedine uno nuovo.";

export function adminRecoveryLink(origin: string, tokenHash: string) {
  return `${origin}/accesso/nuova-password#token_hash=${encodeURIComponent(tokenHash)}`;
}

export function readRecoveryAddress(search: string, hash: string): RecoveryAddress {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const pick = (name: string) => fragment.get(name) || query.get(name);
  if (pick("error") || pick("error_code")) return { kind: "error" };
  const tokenHash = pick("token_hash");
  if (tokenHash) return { kind: "token", tokenHash };
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "session", accessToken, refreshToken };
  if (query.get("code") && !query.get("next")) return { kind: "code" };
  return { kind: "none" };
}

export function passwordMessage(message: string) {
  const text = message.toLowerCase();
  if (text.includes("different from the old")) return "La nuova password deve essere diversa da quella di prima.";
  if (text.includes("session missing") || text.includes("expired")) return EXPIRED_LINK;
  return "Password non salvata. Riprova tra poco.";
}
