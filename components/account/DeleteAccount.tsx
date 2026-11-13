"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function DeleteAccount({ email }: { email: string }) {
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Eliminazione non riuscita.");
        return;
      }
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Eliminazione non riuscita.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Elimina account</h2>
      <p>Cancella il profilo, la rosa e le iscrizioni. Le leghe con altri giocatori restano e passano a un altro partecipante. L&apos;operazione non si annulla.</p>
      <label>
        Scrivi ELIMINA per confermare
        <input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" />
      </label>
      {error ? <p className="banner">{error}</p> : null}
      <button className="danger" type="button" disabled={pending || phrase !== "ELIMINA"} onClick={() => void remove()}>
        Elimina account di {email}
      </button>
    </section>
  );
}
