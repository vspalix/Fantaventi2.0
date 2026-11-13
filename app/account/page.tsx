import { DeleteAccount } from "@/components/account/DeleteAccount";
import { getSessionUser } from "@/lib/server/session";
import { createAdminSupabase, hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AccountPage() {
  if (!hasPublicSupabaseEnv()) redirect("/accesso");
  const user = await getSessionUser();
  if (!user) redirect("/accesso");
  let name = user.email ?? "Account";
  let phone = "";
  if (hasServiceSupabaseEnv()) {
    const profile = await createAdminSupabase()
      .from("profiles")
      .select("first_name, last_name, phone, display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profile.data) {
      const full = [profile.data.first_name, profile.data.last_name].filter(Boolean).join(" ");
      name = full || (profile.data.display_name as string) || name;
      phone = (profile.data.phone as string | null) ?? "";
    }
  }

  return (
    <section className="stack" style={{ maxWidth: 560 }}>
      <header>
        <h1 className="section-title">Account</h1>
        <p className="lede">{name}{phone ? ` · ${phone}` : ""}</p>
        <p>{user.email}</p>
      </header>
      <DeleteAccount email={user.email ?? "questo account"} />
    </section>
  );
}
