import { ChangePassword } from "@/components/account/ChangePassword";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { PublicName } from "@/components/account/PublicName";
import { LegalLinks } from "@/components/LegalLinks";
import { reportError } from "@/lib/server/error-report";
import { getSessionUser } from "@/lib/server/session";
import { createAdminSupabase, hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AccountPage() {
  if (!hasPublicSupabaseEnv()) redirect("/accesso");
  const user = await getSessionUser();
  if (!user) redirect("/accesso");
  let full = "";
  let phone = "";
  let username = "";
  let unreadable = false;
  if (hasServiceSupabaseEnv()) {
    const profile = await createAdminSupabase()
      .from("profiles")
      .select("first_name, last_name, phone, display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profile.error) {
      unreadable = true;
      void reportError("Schermata Account: dati del profilo", new Error(profile.error.message));
    }
    if (profile.data) {
      full = [profile.data.first_name, profile.data.last_name].filter(Boolean).join(" ");
      phone = (profile.data.phone as string | null) ?? "";
      username = (profile.data.display_name as string | null) ?? "";
    }
  }

  return (
    <section className="stack" style={{ maxWidth: 560 }}>
      <header>
        <h1 className="section-title">Account</h1>
        {unreadable ? <p className="banner">I tuoi dati non si sono caricati. Ricarica la pagina tra poco.</p> : null}
        {full ? <p className="lede">{full}{phone ? ` · ${phone}` : ""}</p> : phone ? <p className="lede">{phone}</p> : null}
        <p>{user.email}</p>
        <p className="small muted">Questi dati restano visibili solo a te. Gli altri vedono username e nome squadra.</p>
        <LegalLinks />
      </header>
      <PublicName current={username} />
      <ChangePassword />
      <DeleteAccount />
    </section>
  );
}
