"use client";

import { useEffect, useState } from "react";

type League = { id: string; name: string };

export function BroadcastDesk() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [emailReady, setEmailReady] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [leagueId, setLeagueId] = useState("");
  const [inbox, setInbox] = useState(true);
  const [email, setEmail] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/broadcast")
      .then(async (response) => {
        const body = await response.json() as { leagues?: League[]; emailReady?: boolean };
        if (response.ok) {
          setLeagues(body.leagues ?? []);
          setEmailReady(body.emailReady === true);
        }
      })
      .catch(() => undefined);
  }, []);

  async function send(test: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          message,
          leagueId: leagueId || null,
          inbox,
          email,
          test,
          confirm: !test && confirming,
        }),
      });
      const body = await response.json() as { recipients?: number; inbox?: number; mailed?: number; emailSkipped?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Invio non riuscito.");
      const mail = body.emailSkipped ? " Email non inviata: mancano RESEND_API_KEY e RESEND_FROM." : ` Email: ${body.mailed ?? 0}.`;
      setNote(`${test ? "Prova inviata a te." : "Inviata."} Destinatari ${body.recipients ?? 0}. Campanella: ${body.inbox ?? 0}.${mail}`);
      setConfirming(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
      <label>Oggetto<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
      <label>Messaggio<textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
      <label>
        Destinatari
        <select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>
          <option value="">Tutti gli utenti</option>
          {leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={inbox} onChange={(event) => setInbox(event.target.checked)} />Campanella in app</label>
      <label className="check"><input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} />Email</label>
      <p className="small muted">{emailReady ? "Resend è configurato." : "L'email parte solo se sul server ci sono RESEND_API_KEY e RESEND_FROM."}</p>
      <div className="row">
        <button className="ghost" type="button" disabled={busy} onClick={() => void send(true)}>Invia test a me stesso</button>
        {confirming ? (
          <button className="primary" type="button" disabled={busy} onClick={() => void send(false)}>Conferma invio</button>
        ) : (
          <button className="primary" type="button" disabled={busy} onClick={() => setConfirming(true)}>Invia</button>
        )}
      </div>
    </section>
  );
}
