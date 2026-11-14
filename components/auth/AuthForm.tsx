"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { pendingInvitePath, safeJoinPath, writeInviteCookie } from "@/lib/invite";
import { createBrowserSupabase } from "@/lib/supabase/browser";

function signInMessage(message: string) {
  const text = message.toLowerCase();
  if (text.includes("invalid login") || text.includes("invalid credentials")) return "Email o password non corretti.";
  if (text.includes("email not confirmed")) return "Conferma l'email prima di accedere.";
  return message;
}

export function AuthForm() {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "recover">("sign-in");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [acceptRules, setAcceptRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const next = safeJoinPath(new URLSearchParams(window.location.search).get("next"));
    if (!next) return;
    const code = new URLSearchParams(next.slice(next.indexOf("?") + 1)).get("code");
    if (code) writeInviteCookie(code);
  }, []);

  function switchMode(next: "sign-in" | "sign-up" | "recover") {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        setError(signInMessage(result.error.message));
        return;
      }
      window.location.assign(pendingInvitePath());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Accesso non riuscito.");
    } finally {
      setPending(false);
    }
  }

  async function signUp(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          phone,
          email,
          emailConfirm,
          password,
          passwordConfirm,
          acceptRules,
        }),
      });
      const body = (await response.json()) as { error?: string; email?: string };
      if (!response.ok) {
        setError(body.error ?? "Registrazione non riuscita.");
        return;
      }
      const supabase = createBrowserSupabase();
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        setError(signInMessage(result.error.message));
        return;
      }
      window.location.assign(pendingInvitePath());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Registrazione non riuscita.");
    } finally {
      setPending(false);
    }
  }

  async function recover(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = createBrowserSupabase();
      const redirectTo = `${window.location.origin}/accesso/nuova-password`;
      const result = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setNotice("Se l'email è registrata, ti abbiamo inviato il link per scegliere una nuova password.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recupero non riuscito.");
    } finally {
      setPending(false);
    }
  }

  if (mode === "recover") {
    return (
      <form className="stack" onSubmit={(event) => void recover(event)}>
        <h1 className="section-title">Recupera la password</h1>
        <p className="lede">Ti inviamo un link per sceglierne una nuova.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </label>
        {error ? <p className="banner">{error}</p> : null}
        {notice ? <p className="banner ok">{notice}</p> : null}
        <button className="primary" type="submit" disabled={pending}>Invia il link</button>
        <p><button className="text-button" type="button" onClick={() => switchMode("sign-in")}>Torna all&apos;accesso</button></p>
      </form>
    );
  }

  if (mode === "sign-in") {
    return (
      <form className="stack" onSubmit={(event) => void signIn(event)}>
        <h1 className="section-title">Accedi</h1>
        <p className="lede">Entra con l&apos;email e la password dell&apos;account.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={6} required />
        </label>
        {error ? <p className="banner">{error}</p> : null}
        <button className="primary" type="submit" disabled={pending}>Accedi</button>
        <p><button className="text-button" type="button" onClick={() => switchMode("recover")}>Password dimenticata</button></p>
        <p>Non hai un account? <button className="text-button" type="button" onClick={() => switchMode("sign-up")}>Registrati</button></p>
      </form>
    );
  }

  return (
    <form className="stack" onSubmit={(event) => void signUp(event)}>
      <h1 className="section-title">Crea l&apos;account</h1>
      <p className="lede">Nome, telefono e email restano sul tuo profilo.</p>
      <label>
        Nome
        <input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" required />
      </label>
      <label>
        Cognome
        <input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" required />
      </label>
      <label>
        Telefono
        <input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" required />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
      </label>
      <label>
        Ripeti l&apos;email
        <input type="email" value={emailConfirm} onChange={(event) => setEmailConfirm(event.target.value)} autoComplete="email" required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      <label>
        Ripeti la password
        <input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      <label className="check">
        <input type="checkbox" checked={acceptRules} onChange={(event) => setAcceptRules(event.target.checked)} required />
        <span>Accetto il <Link href="/rules">regolamento</Link> di Fantaventi.</span>
      </label>
      {error ? <p className="banner">{error}</p> : null}
      <button className="primary" type="submit" disabled={pending}>Crea account</button>
      <p>Hai già un account? <button className="text-button" type="button" onClick={() => switchMode("sign-in")}>Accedi</button></p>
    </form>
  );
}
