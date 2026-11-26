import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import { reportError } from "@/lib/server/error-report";
import { createServerSupabase, hasPublicSupabaseEnv } from "@/lib/supabase/server";

export const SESSION_UNAVAILABLE = "In questo momento non riusciamo a verificare il tuo accesso. Riprova tra poco.";

const sessionState = cache(async (): Promise<{ user: User | null; unavailable: boolean }> => {
  if (!hasPublicSupabaseEnv()) return { user: null, unavailable: false };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  // Chi non ha fatto l'accesso è normale. Il servizio che non risponde no.
  const unavailable = Boolean(error && (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500));
  if (unavailable) void reportError("Verifica dell'accesso", error, { kind: "database" });
  return { user: data.user, unavailable };
});

export async function getSessionUser() {
  return (await sessionState()).user;
}

export async function sessionUnavailable() {
  return (await sessionState()).unavailable;
}

export async function requireSessionUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) {
    const unavailable = await sessionUnavailable();
    const error = new Error(unavailable ? SESSION_UNAVAILABLE : "Accesso richiesto.");
    Object.assign(error, { status: unavailable ? 503 : 401, reported: unavailable });
    throw error;
  }
  return user;
}

export function errorStatus(error: unknown): number {
  if (typeof error === "object" && error && "status" in error) {
    const status = (error as { status?: number }).status;
    if (typeof status === "number") return status;
  }
  return 400;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Operazione non riuscita.";
}
