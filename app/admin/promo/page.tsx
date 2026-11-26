import { checkAdminPage } from "@/components/admin/AdminGate";
import { PromoDesk } from "@/components/admin/PromoDesk";

export default async function PromoPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Banner</h1>
        <p className="lede">L&apos;immagine compare a metà della dashboard. Il link delle probabili apre il tasto in home.</p>
      </header>
      <PromoDesk />
    </section>
  );
}
