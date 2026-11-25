"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { readableError } from "@/lib/feedback";

export function DeleteAccount() {
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    if (!window.confirm("Eliminare definitivamente l'account? L'operazione non si annulla.")) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      let body: { error?: string } = {};
      try {
        body = (await response.json()) as { error?: string };
      } catch {
        setError("Il server non ha risposto. L'account non è stato toccato: resta qui e riprova.");
        return;
      }
      if (!response.ok) {
        const detail = body.error ?? "Eliminazione non riuscita.";
        setError(`${detail} L'account non è stato toccato: resta su questa pagina e riprova.`);
        return;
      }
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
      window.location.assign("/accesso");
    } catch (reason) {
      setError(readableError(reason, "Eliminazione non riuscita. L'account non è stato toccato: resta qui e riprova."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Gestione account</h2>
      <p>
        Elimina profilo, rosa, formazioni e iscrizioni. Se sei presidente di una lega con altri partecipanti,
        prima trasferisci il ruolo o sciogli la lega. L&apos;operazione non si annulla.
      </p>
      <label>
        Scrivi ELIMINA per confermare
        <input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" />
      </label>
      {error ? <p className="banner">{error}</p> : null}
      <button className="danger solid" type="button" disabled={pending || phrase !== "ELIMINA"} onClick={() => void remove()}>
        Elimina definitivamente il mio account
      </button>
    </section>
  );
}
