import type { User } from "@supabase/supabase-js";
import { requireSessionUser } from "@/lib/server/session";
import { createAdminSupabase, hasServiceSupabaseEnv } from "@/lib/supabase/admin";

export type PlatformRole = "member" | "super_admin";

function denied() {
  const error = new Error("Il laboratorio è riservato al super admin della piattaforma.");
  (error as Error & { status: number }).status = 403;
  return error;
}

export async function readPlatformRole(userId: string): Promise<PlatformRole> {
  if (!hasServiceSupabaseEnv()) return "member";
  const admin = createAdminSupabase();
  const { data, error } = await admin.from("profiles").select("platform_role").eq("id", userId).maybeSingle();
  if (error) {
    if (/platform_role|schema cache|could not find/i.test(error.message)) return "member";
    throw new Error(error.message);
  }
  return data?.platform_role === "super_admin" ? "super_admin" : "member";
}

export async function isSuperAdmin(userId: string) {
  return (await readPlatformRole(userId)) === "super_admin";
}

export async function requireSuperAdmin(): Promise<User> {
  const user = await requireSessionUser();
  if (!(await isSuperAdmin(user.id))) throw denied();
  return user;
}
