"use client";

import { useState, type FormEvent } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { readableError } from "@/lib/feedback";

export function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    setNotice(null);
    try {
      const supabase = createBrowserSupabase();
      const session = await supabase.auth.getUser();
      const email = session.data.user?.email;
      if (!email) {
        setError("Sessione assente. Entra di nuovo e riprova da questa pagina.");
        return;
      }
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) {
        setError("La password attuale non è corretta. Non è stato cambiato nulla.");
        return;
      }
      const result = await supabase.auth.updateUser({ password });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setCurrent("");
      setPassword("");
      setConfirm("");
      setNotice("Password aggiornata.");
    } catch (reason) {
      setError(readableError(reason, "Aggiornamento non riuscito. La password è rimasta quella di prima."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(event) => void save(event)}>
      <h2>Password</h2>
      <p className="small muted">Servono la password attuale e una nuova di almeno 8 caratteri.</p>
      <label>
        Password attuale
        <input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        Nuova password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      <label>
        Ripeti la nuova password
        <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      {error ? <p className="banner">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
      <button className="primary" type="submit" disabled={pending}>Salva password</button>
    </form>
  );
}
