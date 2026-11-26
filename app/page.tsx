import Link from "next/link";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { readBrand } from "@/lib/server/brand";
import { loadHomeBoard } from "@/lib/server/home-board";
import { publicError } from "@/lib/server/api-error";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function HomePage() {
  const brand = await readBrand();
  const user = hasPublicSupabaseEnv() ? await getSessionUser() : null;
  if (user && hasServiceSupabaseEnv()) {
    try {
      return <HomeDashboard board={await loadHomeBoard(user.id)} logoUrl={brand.logoUrl} />;
    } catch (error) {
      return (
        <section className="card">
          <h2>Home non disponibile</h2>
          <p>{publicError("Schermata Home", error).message}</p>
        </section>
      );
    }
  }

  return (
    <section className="hero">
      <p className="small muted">Fantaventi</p>
      {brand.logoUrl ? <img className="round-logo" src={brand.logoUrl} alt="" /> : null}
      <h1>Costruisci la rosa. Invita la lega.</h1>
      <p className="lede">Un calciatore per club. Entra e trovi la tua lega.</p>
      <div className="landing-actions">
        <Link className="primary" href="/accesso">Accedi / Registrati</Link>
      </div>
    </section>
  );
}
