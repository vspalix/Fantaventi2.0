import { checkAdminPage } from "@/components/admin/AdminGate";
import { PushDesk } from "@/components/admin/PushDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function PushAdminPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Notifiche</h1>
        <p className="lede">Manda un messaggio a tutti oppure scegli quali avvisi partono da soli durante la giornata.</p>
      </header>
      <PushDesk />
    </section>
  );
}
