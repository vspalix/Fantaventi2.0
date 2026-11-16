import { AdminNav } from "@/components/admin/AdminNav";
import { BroadcastDesk } from "@/components/admin/BroadcastDesk";

export default function ComunicazioniPage() {
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Invia comunicazione</h1>
        <p className="lede">Prima una prova a te stesso, poi la conferma per tutti.</p>
      </header>
      <AdminNav />
      <BroadcastDesk />
    </section>
  );
}
