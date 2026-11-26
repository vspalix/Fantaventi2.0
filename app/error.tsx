"use client";

// Compare quando una schermata non riesce a caricarsi. I dettagli li riceve l'amministratore.
export default function ErrorPage() {
  return (
    <section className="card stack" role="alert">
      <h2>Qualcosa non ha funzionato</h2>
      <p>La schermata non si è caricata. Riprova tra poco.</p>
      <button className="primary" type="button" onClick={() => window.location.reload()}>Riprova</button>
      <a href="/">Torna alla home</a>
    </section>
  );
}
