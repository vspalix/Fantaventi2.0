import { AdminNav } from "@/components/admin/AdminNav";
import { AvailabilityDesk } from "@/components/admin/AvailabilityDesk";

export default function IndisponibiliPage() {
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Indisponibili</h1>
        <p className="lede">La fonte si può cambiare. I badge in formazione valgono solo per la giornata aperta.</p>
      </header>
      <AdminNav />
      <AvailabilityDesk />
    </section>
  );
}
