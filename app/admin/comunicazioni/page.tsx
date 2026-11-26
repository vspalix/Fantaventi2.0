import { checkAdminPage } from "@/components/admin/AdminGate";
import { BroadcastDesk } from "@/components/admin/BroadcastDesk";

export default async function ComunicazioniPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Invia comunicazione</h1>
        <p className="lede">Prima una prova a te stesso, poi la conferma per tutti.</p>
      </header>
      <BroadcastDesk />
    </section>
  );
}
