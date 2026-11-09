import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { SetupNotice } from "@/components/SetupNotice";
import { getSessionUser } from "@/lib/server/session";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function AccessPage() {
  if (hasPublicSupabaseEnv() && await getSessionUser()) redirect("/");
  return (
    <section className="stack" style={{ maxWidth: 480 }}>
      {hasPublicSupabaseEnv() ? <div className="card"><AuthForm /></div> : <SetupNotice />}
    </section>
  );
}
