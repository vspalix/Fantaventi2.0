import { AdminNav } from "@/components/admin/AdminNav";
import { PushDesk } from "@/components/admin/PushDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default function PushAdminPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Notifiche</h1>
        <p className="lede">Da super admin scrivi un messaggio e lo mandi subito. Qui regoli anche i testi automatici.</p>
      </header>
      <AdminNav />
      <PushDesk />
    </section>
  );
}
