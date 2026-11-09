import type { User } from "@supabase/supabase-js";
import { createServerSupabase, hasPublicSupabaseEnv } from "@/lib/supabase/server";

export async function getSessionUser(): Promise<User | null> {
  if (!hasPublicSupabaseEnv()) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function requireSessionUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) {
    const error = new Error("Accesso richiesto.");
    (error as Error & { status: number }).status = 401;
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
