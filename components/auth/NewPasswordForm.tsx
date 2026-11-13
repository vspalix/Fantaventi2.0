"use client";

import { useState, type FormEvent } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("La password deve avere almeno 8 caratteri.");
      return;
    }
    if (password !== confirm) {
      setError("Le due password non coincidono.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const result = await supabase.auth.updateUser({ password });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      await fetch("/api/account/password", { method: "POST" });
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Aggiornamento non riuscito.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <h1 className="section-title">Nuova password</h1>
      <p className="lede">Scegli la password con cui entrerai da ora.</p>
      <label>
        Nuova password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      <label>
        Ripeti la password
        <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      {error ? <p className="banner">{error}</p> : null}
      <button className="primary" type="submit" disabled={pending}>Salva password</button>
    </form>
  );
}
