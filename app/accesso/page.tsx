import { AuthForm } from "@/components/auth/AuthForm";
import { SetupNotice } from "@/components/SetupNotice";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default function AccessPage() {
  return (
    <section className="stack" style={{ maxWidth: 480 }}>
      <header>
        <h1 className="section-title">Accesso</h1>
        <p className="lede">Un account basta per creare la squadra e le leghe private.</p>
      </header>
      {hasPublicSupabaseEnv() ? <div className="card"><AuthForm /></div> : <SetupNotice />}
    </section>
  );
}
