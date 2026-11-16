import { AdminNav } from "@/components/admin/AdminNav";
import { BadgeDesk } from "@/components/admin/BadgeDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default function ClubColorsPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  return (
    <section className="stack">
      <AdminNav />
      <BadgeDesk />
    </section>
  );
}
