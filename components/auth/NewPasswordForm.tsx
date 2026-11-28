"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { pendingInvitePath } from "@/lib/invite";
import { EXPIRED_LINK, passwordMessage, readRecoveryAddress, type RecoveryAddress } from "@/lib/password-recovery";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { readableError } from "@/lib/feedback";

export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const address = useRef<RecoveryAddress>({ kind: "none" });

  useEffect(() => {
    const found = readRecoveryAddress(window.location.search, window.location.hash);
    if (found.kind === "none") return;
    address.current = found;
    if (found.kind === "error") setError(EXPIRED_LINK);
    // I codici del link non restano nella barra degli indirizzi.
    if (found.kind !== "code") window.history.replaceState(null, "", window.location.pathname);
  }, []);

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
      // Il link si consuma solo ora: le anteprime delle chat non lo bruciano.
      const link = address.current;
      if (link.kind === "error") {
        setError(EXPIRED_LINK);
        return;
      }
      if (link.kind === "token" || link.kind === "session") {
        const opened = link.kind === "token"
          ? await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: "recovery" })
          : await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
        if (opened.error) {
          setError(EXPIRED_LINK);
          return;
        }
        address.current = { kind: "none" };
      }
      const result = await supabase.auth.updateUser({ password });
      if (result.error) {
        setError(passwordMessage(result.error.message));
        return;
      }
      await fetch("/api/account/password", { method: "POST" });
      window.location.assign(pendingInvitePath());
    } catch (reason) {
      setError(readableError(reason, "Aggiornamento non riuscito."));
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
