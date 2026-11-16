import Link from "next/link";
import { RegulationView } from "@/components/rules/RegulationView";
import { generalRegulationMarkdown } from "@/config/gameRules";

export default function RegolamentoPage() {
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Regolamento</h1>
        <p className="lede">I numeri di base con cui il motore calcola. Una lega può cambiare formato, capitano, difesa e checkpoint.</p>
      </header>
      <article className="card stack">
        <RegulationView markdown={generalRegulationMarkdown()} />
        <p className="small muted">
          Il testo della tua lega, se è stato personalizzato, sta nella sezione Regolamento della lega.
        </p>
        <Link href="/leghe">Apri le leghe</Link>
      </article>
    </section>
  );
}
