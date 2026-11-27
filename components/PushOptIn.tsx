"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readableError } from "@/lib/feedback";
import { enablePush, PUSH_CHANGED_EVENT, readPushState, type PushState } from "@/lib/web-push-client";

/** Versione compatta per la scheda Live: il riquadro completo è in Account. */
export function PushOptIn() {
  const [state, setState] = useState<PushState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () => void readPushState().then((next) => { if (!stop) setState(next); });
    load();
    window.addEventListener(PUSH_CHANGED_EVENT, load);
    return () => {
      stop = true;
      window.removeEventListener(PUSH_CHANGED_EVENT, load);
    };
  }, []);

  async function enable() {
    setPending(true);
    setMessage(null);
    try {
      const next = await enablePush();
      setState(next);
      setMessage(next === "on" ? "Notifiche attive su questo dispositivo." : null);
    } catch (error) {
      setMessage(readableError(error, "Notifiche non attivate."));
    } finally {
      setPending(false);
    }
  }

  if (state === "loading" || state === "native" || (state === "on" && !message)) return null;
  return (
    <div className="row">
      {state === "off" ? (
        <button className="ghost" type="button" disabled={pending} onClick={() => void enable()}>Attiva notifiche</button>
      ) : state !== "on" ? (
        <Link className="ghost" href="/account#notifiche">Come attivare le notifiche</Link>
      ) : null}
      {message ? <span className="small muted">{message}</span> : null}
    </div>
  );
}
