import { AdminNav } from "@/components/admin/AdminNav";
import { AnnounceDesk } from "@/components/admin/AnnounceDesk";

export default function AnnunciPage() {
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Annunci e locandine</h1>
        <p className="lede">Un avviso attivo compare al centro dello schermo appena si entra.</p>
      </header>
      <AdminNav />
      <AnnounceDesk />
    </section>
  );
}
