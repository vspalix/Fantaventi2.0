import { ChangePassword } from "@/components/account/ChangePassword";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { PublicName } from "@/components/account/PublicName";
import { LegalLinks } from "@/components/LegalLinks";
import { NotificationToggle } from "@/components/notifications/NotificationToggle";
import { ViewSwitch } from "@/components/ViewSwitch";
import { reportError } from "@/lib/server/error-report";
import { getSessionUser } from "@/lib/server/session";
import { hostAccess } from "@/lib/server/view-mode";
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

  const shown = username || user.email || "";
  const { canSwitch } = hasServiceSupabaseEnv() ? await hostAccess(user.id) : { canSwitch: false };
  return (
    <section className="ac">
      <h1 className="section-title">Account</h1>
      {unreadable ? <p className="banner">I tuoi dati non si sono caricati. Ricarica la pagina tra poco.</p> : null}
      <article className="card ac-me">
        <span className="ac-avatar" aria-hidden="true">{shown.trim().charAt(0).toUpperCase()}</span>
        <div>
          <strong>{username || "Senza username"}</strong>
          {full ? <span>{full}</span> : null}
          <span>{user.email}</span>
          {phone ? <span>{phone}</span> : null}
          <small>Email, nome e telefono li vedi solo tu.</small>
        </div>
      </article>
      {canSwitch ? <ViewSwitch to="host" className="view-switch-wide" /> : null}
      <PublicName current={username} />
      <ChangePassword />
      <NotificationToggle />
      <DeleteAccount />
      <LegalLinks />
    </section>
  );
}
