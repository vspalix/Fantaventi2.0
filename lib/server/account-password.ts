import { createAdminSupabase } from "@/lib/supabase/admin";

export async function mustResetPassword(userId: string) {
  const admin = createAdminSupabase();
  const row = await admin.from("profiles").select("must_reset_password").eq("id", userId).maybeSingle();
  if (row.error) {
    if (/must_reset_password|schema cache|could not find|column/i.test(row.error.message)) return false;
    throw new Error(row.error.message);
  }
  return row.data?.must_reset_password === true;
}

export async function clearPasswordReset(userId: string) {
  const admin = createAdminSupabase();
  const updated = await admin.from("profiles").update({ must_reset_password: false }).eq("id", userId);
  if (updated.error && !/must_reset_password|schema cache|could not find|column/i.test(updated.error.message)) {
    throw new Error(updated.error.message);
  }
}
