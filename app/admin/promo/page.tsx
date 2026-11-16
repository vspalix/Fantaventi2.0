import { AdminNav } from "@/components/admin/AdminNav";
import { PromoDesk } from "@/components/admin/PromoDesk";

export default function PromoPage() {
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Banner</h1>
        <p className="lede">L&apos;immagine compare a metà della dashboard. Il link delle probabili apre il tasto in home.</p>
      </header>
      <AdminNav />
      <PromoDesk />
    </section>
  );
}
