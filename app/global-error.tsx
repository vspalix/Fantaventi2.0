"use client";

import "./globals.css";

// Ultima rete: sostituisce l'intera pagina quando anche la parte comune non si carica.
export default function GlobalError() {
  return (
    <html lang="it">
      <body>
        <main className="shell page">
          <section className="card stack" role="alert">
            <h2>FantaVenti non si è caricato</h2>
            <p>Qualcosa non ha funzionato dalla nostra parte. Riprova tra poco.</p>
            <button className="primary" type="button" onClick={() => window.location.reload()}>Riprova</button>
          </section>
        </main>
      </body>
    </html>
  );
}
