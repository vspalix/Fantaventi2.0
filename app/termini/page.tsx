import type { Metadata } from "next";
import { LegalLinks } from "@/components/LegalLinks";

export const metadata: Metadata = {
  title: "Termini · FantaVenti",
  description: "Termini di servizio di FantaVenti, gioco gratuito senza scommesse né premi in denaro.",
};

export default function TermsPage() {
  return (
    <article className="stack legal-page">
      <header>
        <h1 className="section-title">Termini di servizio</h1>
        <p className="lede">FantaVenti è un gioco gratuito di intrattenimento sportivo. Non è un servizio di scommesse.</p>
      </header>
      <section className="card stack">
        <h2>Che cos&apos;è</h2>
        <p>FantaVenti permette di creare una rosa, schierare una formazione e confrontare i punteggi con gli altri di una lega. L&apos;uso è gratuito.</p>
        <h2>Niente scommesse, quote o premi in denaro</h2>
        <p>FantaVenti non accetta scommesse, non gestisce quote di iscrizione e non assegna premi in denaro o premi convertibili in denaro. I punti, i gol fantacalcio e la classifica sono solo un risultato di gioco. Nessuna vincita può essere ritirata, scambiata o trasformata in un pagamento.</p>
        <h2>Account</h2>
        <p>Per giocare serve un account con dati veri di contatto. Puoi eliminarlo dalla pagina Account. Se sei presidente di una lega in cui giocano altre persone, prima devi trasferire quel ruolo o sciogliere la lega.</p>
        <h2>Uso corretto</h2>
        <p>Non usare il servizio per organizzare giochi d&apos;azzardo o per raccogliere soldi tra i partecipanti. Il regolamento di gioco descrive come si calcolano i punteggi e può essere adattato da chi gestisce la lega, sempre senza introdurre denaro.</p>
        <h2>Disponibilità</h2>
        <p>Il servizio può essere sospeso per manutenzione o per un errore. I punteggi dipendono da fonti pubbliche e possono essere corretti. Non c&apos;è un obbligo di risultato sportivo.</p>
        <h2>Legge applicabile</h2>
        <p>Si applica la legge italiana. Per i consumatori resta il foro previsto dal codice del consumo.</p>
        <LegalLinks />
      </section>
    </article>
  );
}
