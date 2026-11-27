"use client";

import { isAppleMobile, type PushState } from "@/lib/web-push-client";

/** Passi per iPhone: le notifiche web arrivano solo dall'icona nella schermata Home. */
export function IphoneSteps() {
  return (
    <ol className="push-steps">
      <li>Apri il sito in <strong>Safari</strong>.</li>
      <li>Tocca il pulsante <strong>Condividi</strong> (il quadrato con la freccia verso l&apos;alto).</li>
      <li>Scegli <strong>Aggiungi alla schermata Home</strong> e conferma con <strong>Aggiungi</strong>.</li>
      <li>Chiudi Safari e apri <strong>FantaVenti dall&apos;icona</strong> nella schermata Home.</li>
      <li>Vai in <strong>Account</strong> e tocca <strong>Attiva notifiche</strong>, poi <strong>Consenti</strong>.</li>
    </ol>
  );
}

/** Spiegazione per gli stati in cui il pulsante da solo non basta. */
export function PushHelp({ state }: { state: PushState }) {
  if (state === "ios-browser") {
    return (
      <>
        <p className="small">Su iPhone le notifiche arrivano solo se apri FantaVenti dall&apos;icona nella schermata Home. Servono pochi passi:</p>
        <IphoneSteps />
        <p className="small muted">Serve iOS 16.4 o successivo. Già fatto? Apri FantaVenti dall&apos;icona, non da Safari.</p>
      </>
    );
  }
  if (state === "ios-old") {
    return <p className="small">Questo iPhone non riceve notifiche dai siti. Aggiorna iOS (Impostazioni › Generali › Aggiornamento software) alla versione 16.4 o successiva, poi riapri FantaVenti dall&apos;icona.</p>;
  }
  if (state === "denied") {
    return isAppleMobile() ? (
      <p className="small">Le notifiche sono bloccate. Apri <strong>Impostazioni › Notifiche › FantaVenti</strong>, attiva <strong>Consenti notifiche</strong>, poi chiudi e riapri FantaVenti.</p>
    ) : (
      <p className="small">Le notifiche sono bloccate per questo sito. Tocca il lucchetto accanto all&apos;indirizzo, consenti le notifiche e ricarica la pagina.</p>
    );
  }
  if (state === "unsupported") {
    return <p className="small">Questo browser non riceve notifiche. Su computer e Android usa Chrome, Edge o Firefox; su iPhone segui i passi con Safari e la schermata Home.</p>;
  }
  if (state === "native") {
    return <p className="small">Nell&apos;app FantaVenti le notifiche si gestiscono dalle impostazioni del telefono, alla voce FantaVenti.</p>;
  }
  return null;
}
