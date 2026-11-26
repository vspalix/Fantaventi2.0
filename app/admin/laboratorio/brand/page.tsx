import { checkAdminPage } from "@/components/admin/AdminGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { BrandDesk } from "@/components/admin/BrandDesk";
import { SetupNotice } from "@/components/SetupNotice";
import { readBrand } from "@/lib/server/brand";
import { publicError } from "@/lib/server/api-error";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function BrandPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  try {
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
