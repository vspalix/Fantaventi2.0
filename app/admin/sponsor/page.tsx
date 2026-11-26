import { checkAdminPage } from "@/components/admin/AdminGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { SponsorDesk } from "@/components/admin/SponsorDesk";

export default async function SponsorPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Sponsor</h1>
        <p className="lede">La striscia scorre da destra a sinistra sotto la sala stampa. I secondi valgono subito, senza un nuovo deploy.</p>
      </header>
      <AdminNav />
      <SponsorDesk />
    </section>
  );
}
