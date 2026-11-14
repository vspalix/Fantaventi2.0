"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clearInviteCookie, joinHref, writeInviteCookie } from "@/lib/invite";

export function JoinClient({ code }: { code: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    writeInviteCookie(code);
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as { error?: string; league?: { id: string } };
      if (cancelled) return;
      if (response.status === 401) {
        window.location.assign(`/accesso?next=${encodeURIComponent(joinHref(code))}`);
        return;
      }
      if (!response.ok) {
        if ((body.error ?? "").toLowerCase().includes("rosa")) {
          window.location.assign("/rosa");
          return;
        }
        clearInviteCookie();
        setError(body.error ?? "Codice invito non valido.");
        return;
      }
      clearInviteCookie();
      window.location.assign(body.league?.id ? `/leghe/${body.league.id}` : "/leghe");
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <section className="card stack">
        <h1>Invito non valido</h1>
        <p>{error}</p>
        <Link className="primary" href="/leghe">Vai alle leghe</Link>
      </section>
    );
  }

  return (
    <section className="card">
      <h1>Iscrizione alla lega</h1>
      <p>Ti sto iscrivendo con il codice dell&apos;invito.</p>
    </section>
  );
}
