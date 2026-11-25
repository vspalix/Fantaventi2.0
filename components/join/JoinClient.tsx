"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { JoinImportPrompt } from "@/components/leagues/JoinImportPrompt";
import { clearInviteCookie, joinHref, writeInviteCookie } from "@/lib/invite";
import type { RosterImportSource } from "@/lib/types";

export function JoinClient({ code }: { code: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [offer, setOffer] = useState<{ targetName: string; sources: RosterImportSource[] } | null>(null);

  useEffect(() => {
    writeInviteCookie(code);
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as {
        error?: string;
        league?: { id: string };
        needsImport?: boolean;
        targetName?: string;
        sources?: RosterImportSource[];
      };
      if (cancelled) return;
      if (response.status === 401) {
        window.location.assign(`/accesso?next=${encodeURIComponent(joinHref(code))}`);
        return;
      }
      if (body.needsImport && body.targetName && body.sources) {
        setOffer({ targetName: body.targetName, sources: body.sources });
        return;
      }
      if (!response.ok) {
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

  async function choose(importFromLeagueId: string | null) {
    setPending(true);
    setError(null);
    const response = await fetch("/api/leagues/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, confirmed: true, importFromLeagueId }),
    });
    const body = (await response.json()) as { error?: string; league?: { id: string } };
    if (!response.ok) {
      setError(body.error ?? "Iscrizione non riuscita.");
      setPending(false);
      return;
    }
    clearInviteCookie();
    window.location.assign(body.league?.id ? `/leghe/${body.league.id}` : "/leghe");
  }

  if (offer) {
    return (
      <div className="stack">
        {error ? <p className="banner">{error}</p> : null}
        <JoinImportPrompt targetName={offer.targetName} sources={offer.sources} pending={pending} onPick={(importFromLeagueId) => void choose(importFromLeagueId)} />
      </div>
    );
  }

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
