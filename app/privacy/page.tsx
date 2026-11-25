import type { Metadata } from "next";
import { LegalLinks } from "@/components/LegalLinks";

export const metadata: Metadata = {
  title: "Privacy · FantaVenti",
  description: "Informativa sul trattamento dei dati personali di FantaVenti.",
};

export default function PrivacyPage() {
  return (
    <article className="stack legal-page">
      <header>
        <h1 className="section-title">Informativa privacy</h1>
        <p className="lede">Come FantaVenti tratta i dati di chi crea un account. Il gioco è gratuito e non raccoglie dati di pagamento.</p>
      </header>
      <section className="card stack">
        <h2>Titolare</h2>
        <p>Il titolare del trattamento è chi gestisce FantaVenti. I diritti si esercitano dall&apos;account, con la cancellazione, oppure scrivendo dall&apos;email usata per la registrazione.</p>
        <h2>Dati trattati</h2>
        <p>Alla registrazione chiediamo nome, cognome, telefono, email e password. Poi salviamo la squadra, la rosa, le formazioni, le iscrizioni alle leghe e, se le attivi, le notifiche sul dispositivo.</p>
        <h2>Perché li usiamo</h2>
        <p>I dati servono a creare l&apos;account, far giocare la lega e mostrare classifica e punteggi. La base è l&apos;esecuzione del servizio che hai chiesto registrandoti. Non usiamo i dati per pubblicità di terzi, per scommesse o per decisioni automatizzate che producano effetti giuridici.</p>
        <h2>Chi li riceve</h2>
        <p>Il database e l&apos;accesso sono su Supabase. Il sito è ospitato su Vercel. Non vendiamo i dati e non li cediamo a bookmaker.</p>
        <h2>Per quanto tempo</h2>
        <p>I dati restano finché l&apos;account è attivo. Quando elimini l&apos;account, cancelliamo il profilo, la rosa, le formazioni e l&apos;utente di autenticazione. Se sei presidente di una lega con altri giocatori, la cancellazione resta bloccata finché non trasferisci il ruolo o sciogli la lega, così non sparisce il gruppo degli altri.</p>
        <h2>I tuoi diritti</h2>
        <p>Puoi chiedere accesso, rettifica, cancellazione, limitazione e opposizione, e puoi proporre reclamo al Garante per la protezione dei dati personali. La cancellazione è nella pagina Account: scrivi ELIMINA e confermi. Subito dopo esci dall&apos;app.</p>
        <LegalLinks />
      </section>
    </article>
  );
}
