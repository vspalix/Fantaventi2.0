import { checkAdminPage } from "@/components/admin/AdminGate";
import { PushDesk } from "@/components/admin/PushDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { reportError } from "@/lib/server/error-report";
import { previewLineupReminder } from "@/lib/server/lineup-reminder";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function PushAdminPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const reminder = await previewLineupReminder().catch((error: unknown) => {
    void reportError("Admin: Notifiche, promemoria formazioni", error);
    return null;
  });
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Notifiche</h1>
        <p className="lede">Manda un messaggio a tutti, ricorda la formazione a chi non l'ha schierata e scegli gli avvisi durante le partite.</p>
      </header>
      <PushDesk reminder={reminder} />
    </section>
  );
}
