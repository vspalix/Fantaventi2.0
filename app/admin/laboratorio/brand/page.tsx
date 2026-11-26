import { AdminNav } from "@/components/admin/AdminNav";
import { BrandDesk } from "@/components/admin/BrandDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { readBrand } from "@/lib/server/brand";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { publicError } from "@/lib/server/api-error";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import Link from "next/link";

export default async function BrandPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header><h1 className="section-title">Brand & Grafica</h1></header>
        <AdminNav />
        <Link className="primary" href="/accesso">Entra</Link>
      </section>
    );
  }
  try {
    await requireSuperAdmin();
    const brand = await readBrand();
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Brand & Grafica</h1>
          <p className="lede">Logo, icone dell&apos;app e colore di accento. Se un indirizzo è vuoto restano i file locali.</p>
        </header>
        <AdminNav />
        <BrandDesk initial={brand} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <header><h1 className="section-title">Brand & Grafica</h1></header>
        <p className="banner">{publicError("Admin: Brand", error).message}</p>
      </section>
    );
  }
}
