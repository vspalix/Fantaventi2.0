"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IphoneSteps } from "@/components/notifications/PushHelp";
import { readableError } from "@/lib/feedback";
import { enablePush, PUSH_CHANGED_EVENT, readPushState, type PushState } from "@/lib/web-push-client";

const HIDE_KEY = "fv-push-invite-hidden-until";
const HIDE_DAYS = 14;

function hiddenNow() {
  try {
    return Number(window.localStorage.getItem(HIDE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/** Invito in Home per chi non ha ancora attivato le notifiche su questo dispositivo. */
export function NotificationInvite() {
  const [state, setState] = useState<PushState>("loading");
  const [hidden, setHidden] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let stop = false;
    setHidden(hiddenNow());
    const load = () => void readPushState().then((next) => { if (!stop) setState(next); });
    load();
    window.addEventListener(PUSH_CHANGED_EVENT, load);
    return () => {
      stop = true;
      window.removeEventListener(PUSH_CHANGED_EVENT, load);
    };
  }, []);

  function later() {
    try {
      window.localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_DAYS * 24 * 60 * 60 * 1000));
    } catch {
      // Senza memoria del browser l'invito torna alla prossima apertura: va bene lo stesso.
    }
    setHidden(true);
  }

  async function enable() {
    setPending(true);
    setError(null);
    try {
      const next = await enablePush();
      setState(next);
      if (next === "on") setDone(true);
    } catch (reason) {
      setError(readableError(reason, "Notifiche non attivate. Riprova da Account."));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <article className="card dash-block push-invite">
        <p className="banner ok">Notifiche attive. Puoi mandarti una prova da <Link href="/account#notifiche">Account</Link>.</p>
      </article>
    );
  }
  if (hidden || (state !== "off" && state !== "ios-browser")) return null;

  return (
    <article className="card dash-block push-invite">
      <div className="dash-block-head">
        <h2>Attiva le notifiche</h2>
      </div>
      <p className="small">Un promemoria prima che si chiuda la formazione e le novità della tua lega, direttamente sul telefono.</p>
      {state === "ios-browser" ? (
        <>
          <p className="small">Su iPhone funzionano solo aprendo FantaVenti dall&apos;icona nella schermata Home:</p>
          <IphoneSteps />
        </>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      <div className="dash-actions">
        {state === "off" ? (
          <button className="primary" type="button" disabled={pending} onClick={() => void enable()}>
            {pending ? "Attivazione…" : "Attiva notifiche"}
          </button>
        ) : null}
        <button className="ghost" type="button" onClick={later}>Non ora</button>
      </div>
    </article>
  );
}
