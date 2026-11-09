import { AdminNav } from "@/components/admin/AdminNav";
import { PlatformControl } from "@/components/admin/PlatformControl";
import { SetupNotice } from "@/components/SetupNotice";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default function PlatformLeaguesPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Leghe della piattaforma</h1>
        <p className="lede">Elenco completo e override. Le regole si modificano dentro la lega; da qui nomini gli admin e riapri le formazioni.</p>
      </header>
      <AdminNav />
      <PlatformControl />
    </section>
  );
}
