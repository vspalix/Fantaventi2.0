import { reportError } from "@/lib/server/error-report";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type AuditInput = {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

function missingTable(message: string) {
  return /admin_audit_logs|schema cache|could not find|does not exist/i.test(message);
}

export async function writeAdminAudit(adminId: string, input: AuditInput) {
  try {
    const admin = createAdminSupabase();
    const inserted = await admin.from("admin_audit_logs").insert({
      admin_id: adminId,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      detail: input.detail ?? {},
    });
    if (inserted.error && !missingTable(inserted.error.message)) {
      void reportError("Registro delle azioni admin", new Error(inserted.error.message));
    }
  } catch (error) {
    void reportError("Registro delle azioni admin", error);
  }
}

export type AuditRow = {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
};

export async function listAdminAudit(limit = 80): Promise<{ rows: AuditRow[]; ready: boolean }> {
  const admin = createAdminSupabase();
  const listed = await admin
    .from("admin_audit_logs")
    .select("id, admin_id, action, target_type, target_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (listed.error) {
    if (missingTable(listed.error.message)) return { rows: [], ready: false };
    throw new Error(listed.error.message);
  }

  const ids = [...new Set((listed.data ?? []).map((row) => row.admin_id as string))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const profiles = await admin.from("profiles").select("id, display_name, email").in("id", ids);
    if (!profiles.error) {
      for (const profile of profiles.data ?? []) {
        const label = (profile.display_name as string | null) || (profile.email as string | null) || (profile.id as string);
        names.set(profile.id as string, label);
      }
    }
  }

  return {
    ready: true,
    rows: (listed.data ?? []).map((row) => ({
      id: row.id as string,
      adminId: row.admin_id as string,
      adminName: names.get(row.admin_id as string) ?? (row.admin_id as string),
      action: row.action as string,
      targetType: (row.target_type as string | null) ?? null,
      targetId: (row.target_id as string | null) ?? null,
      createdAt: row.created_at as string,
    })),
  };
}
