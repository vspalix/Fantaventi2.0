import { createAdminSupabase } from "@/lib/supabase/admin";

const DEFAULT_MESSAGE = "Manutenzione in corso. Puoi consultare la lega: formazioni e mercati restano chiusi fino alla fine del calcolo.";

export type MaintenanceState = {
  enabled: boolean;
  message: string;
  updatedAt: string | null;
};

function missing(message: string) {
  return /platform_maintenance|schema cache|could not find|relation|does not exist/i.test(message);
}

export async function readMaintenance(): Promise<MaintenanceState> {
  const admin = createAdminSupabase();
  const row = await admin.from("platform_maintenance").select("enabled, message, updated_at").eq("id", 1).maybeSingle();
  if (row.error) {
    if (missing(row.error.message)) return { enabled: false, message: DEFAULT_MESSAGE, updatedAt: null };
    throw new Error(row.error.message);
  }
  return {
    enabled: Boolean(row.data?.enabled),
    message: (row.data?.message as string | undefined) || DEFAULT_MESSAGE,
    updatedAt: (row.data?.updated_at as string | null) ?? null,
  };
}

export async function assertWritesOpen() {
  const state = await readMaintenance();
  if (!state.enabled) return;
  const error = new Error(state.message) as Error & { status: number };
  error.status = 423;
  throw error;
}

export async function setMaintenance(enabled: boolean, message?: string) {
  const admin = createAdminSupabase();
  const saved = await admin.from("platform_maintenance").upsert({
    id: 1,
    enabled,
    message: message?.trim() || DEFAULT_MESSAGE,
    updated_at: new Date().toISOString(),
  });
  if (saved.error) {
    if (missing(saved.error.message)) {
      const error = new Error("Per l'interruttore esegui platform_maintenance.sql nell'editor SQL di Supabase.") as Error & { status: number };
      error.status = 409;
      throw error;
    }
    throw new Error(saved.error.message);
  }
  return readMaintenance();
}
