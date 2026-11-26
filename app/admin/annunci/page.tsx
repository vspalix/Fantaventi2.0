import { checkAdminPage } from "@/components/admin/AdminGate";
import { AnnounceDesk } from "@/components/admin/AnnounceDesk";

export default async function AnnunciPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Annunci e locandine</h1>
        <p className="lede">Un avviso attivo compare al centro dello schermo appena si entra.</p>
      </header>
      <AnnounceDesk />
    </section>
  );
}
