"use client";

import { useEffect, useState } from "react";
import { DownloadRegulation, RegulationView } from "@/components/rules/RegulationView";

type LeagueOption = { id: string; name: string };

type LoadedRegulation = {
  leagueId: string;
  leagueName: string;
  markdown: string;
  officialMarkdown: string;
  stored: boolean;
  schemaReady: boolean;
  updatedAt: string | null;
  canEdit: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Operazione non riuscita.");
  return payload;
}

export function RegulationEditor({ leagues }: { leagues: LeagueOption[] }) {
  const [leagueId, setLeagueId] = useState(leagues[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [official, setOfficial] = useState("");
  const [schemaReady, setSchemaReady] = useState(true);
  const [stored, setStored] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    setPending("Carico…");
    setError(null);
    void fetch(`/api/leagues/${leagueId}/regulation`)
      .then((response) => readJson<LoadedRegulation>(response))
      .then((document) => {
        if (cancelled) return;
        setDraft(document.markdown);
        setOfficial(document.officialMarkdown);
        setSchemaReady(document.schemaReady);
        setStored(document.stored);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Regolamento non disponibile.");
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  async function save() {
    setPending("Salvo…");
    setError(null);
    setMessage(null);
    try {
      const document = await readJson<LoadedRegulation>(await fetch(`/api/leagues/${leagueId}/regulation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: draft }),
      }));
      setDraft(document.markdown);
      setStored(document.stored);
      setSchemaReady(document.schemaReady);
      setMessage("Regolamento salvato. I partecipanti vedono questo testo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Salvataggio non riuscito.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="stack">
      {leagues.length === 0 ? (
        <article className="card">
          <h2>Nessuna lega da modificare</h2>
          <p>Il regolamento si modifica dalle leghe che hai creato.</p>
        </article>
      ) : (
        <article className="card stack">
          <h2>Gestione regolamento</h2>
          <p>Il testo è Markdown. Il salvataggio sostituisce quello che leggono i partecipanti di questa lega.</p>
          <label>
            Lega
            <select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>
              {leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
            </select>
          </label>
          {schemaReady ? null : <p className="banner">Per salvare esegui regulation.sql nell&apos;editor SQL di Supabase. Fino ad allora i partecipanti leggono il testo ufficiale.</p>}
          {error ? <p className="banner">{error}</p> : null}
          {message ? <p className="banner ok">{message}</p> : null}
          {draft ? (
            <>
              <div className="row">
                <button className="primary" type="button" disabled={pending !== null} onClick={() => void save()}>
                  {pending ?? "Salva regolamento"}
                </button>
                <button className="text-button" type="button" onClick={() => setDraft(official)}>Ripristina il testo ufficiale</button>
                {stored ? <span className="small muted">C&apos;è già un testo salvato.</span> : <span className="small muted">Ancora il testo ufficiale, non salvato.</span>}
              </div>
              <DownloadRegulation leagueId={leagueId} markdown={draft} />
              <div className="rule-editor">
                <label className="stack">
                  Testo
                  <textarea className="rule-source" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck />
                </label>
                <div className="stack">
                  <span>Anteprima</span>
                  <RegulationView markdown={draft} />
                </div>
              </div>
            </>
          ) : null}
        </article>
      )}
    </section>
  );
}
