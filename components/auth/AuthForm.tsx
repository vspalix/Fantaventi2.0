"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(mode: "sign-in" | "sign-up") {
    setPending(true);
    setError(null);
    setMessage(null);
    const supabase = createBrowserSupabase();
    const credentials = { email, password };
    const result = mode === "sign-in"
      ? await supabase.auth.signInWithPassword(credentials)
      : await supabase.auth.signUp(credentials);
    setPending(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (mode === "sign-up" && !result.data.session) {
      setMessage("Account creato. Se la conferma email è attiva, apri il messaggio e poi entra.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={(event) => event.preventDefault()}>
      <label>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required />
      </label>
      {error ? <p className="banner">{error}</p> : null}
      {message ? <p className="banner ok">{message}</p> : null}
      <div className="row">
        <button className="primary" type="button" disabled={pending} onClick={() => submit("sign-in")}>
          Entra
        </button>
        <button className="ghost" type="button" disabled={pending} onClick={() => submit("sign-up")}>
          Crea account
        </button>
      </div>
    </form>
  );
}
