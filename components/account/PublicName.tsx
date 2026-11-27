"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isPublicHandle } from "@/lib/public-name";
import { readableError } from "@/lib/feedback";

export function PublicName({ current }: { current: string }) {
  const router = useRouter();
  const [username, setUsername] = useState(isPublicHandle(current) ? current : "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Username non salvato.");
        return;
      }
      setNotice("Username aggiornato. Gli altri vedono questo nome accanto alla squadra.");
      router.refresh();
    } catch (reason) {
      setError(readableError(reason, "Username non salvato."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(event) => void save(event)}>
      <h2 id="ac-username">Username</h2>
      <div className="ac-row">
        <input
          aria-labelledby="ac-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9_.-]{3,20}"
          required
        />
        <button className="primary" type="submit" disabled={pending || !isPublicHandle(username.trim())}>Salva</button>
      </div>
      <p className="small muted">È il nome che gli altri vedono accanto alla tua squadra.</p>
      {error ? <p className="banner">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
    </form>
  );
}
