"use client";

import { useEffect, useState } from "react";
import { PushHelp } from "@/components/notifications/PushHelp";
import { readableError } from "@/lib/feedback";
import {
  enablePush,
  isAppleMobile,
  PUSH_CHANGED_EVENT,
  readPushState,
  refreshPushOnServer,
  sendTestPush,
  type PushState,
} from "@/lib/web-push-client";

/** Riquadro «Notifiche» nella schermata Account. */
export function NotificationSettings() {
  const [state, setState] = useState<PushState>("loading");
  const [pending, setPending] = useState<"enable" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function load(sync: boolean) {
      const next = await readPushState();
      if (stop) return;
      setState(next);
      // Il server potrebbe non conoscere più questo dispositivo (cambio di account, iscrizione scaduta).
      if (sync && next === "on") {
        refreshPushOnServer().catch((reason: unknown) => {
          if (!stop) setError(readableError(reason, "Non riusciamo a confermare le notifiche di questo dispositivo."));
        });
      }
    }
    void load(true);
    const onChange = () => void load(false);
    window.addEventListener(PUSH_CHANGED_EVENT, onChange);
    return () => {
      stop = true;
      window.removeEventListener(PUSH_CHANGED_EVENT, onChange);
    };
  }, []);

  async function enable() {
    setPending("enable");
    setError(null);
    setNotice(null);
    try {
      const next = await enablePush();
      setState(next);
      if (next === "on") setNotice("Notifiche attive su questo dispositivo. Ora puoi mandarti una prova.");
    } catch (reason) {
      setError(readableError(reason, "Notifiche non attivate. Riprova tra poco."));
      setState(await readPushState());
    } finally {
      setPending(null);
    }
  }

  async function test() {
    setPending("test");
    setError(null);
    setNotice(null);
    try {
      setNotice(await sendTestPush());
    } catch (reason) {
      setError(readableError(reason, "Prova non inviata. Riprova tra poco."));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card stack" id="notifiche">
      <h2>Notifiche</h2>
      <p className="small muted">
        Ti avvisiamo prima che si chiuda la formazione e con le novità della tua lega. Valgono per il dispositivo che stai usando:
        attivale su ognuno dove vuoi riceverle.
      </p>
      {state === "loading" ? <p className="small muted">Controllo il dispositivo…</p> : null}
      {state === "on" ? <p className="banner ok">Attive su questo dispositivo.</p> : null}
      <PushHelp state={state} />
      {error ? <p className="banner">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
      {state === "off" ? (
        <button className="primary" type="button" disabled={pending !== null} onClick={() => void enable()}>
          {pending === "enable" ? "Attivazione…" : "Attiva notifiche"}
        </button>
      ) : null}
      {state === "on" ? (
        <>
          <button className="ghost" type="button" disabled={pending !== null} onClick={() => void test()}>
            {pending === "test" ? "Invio…" : "Mandami una notifica di prova"}
          </button>
          <p className="small muted">
            La prova arriva solo ai tuoi dispositivi, dopo qualche secondo.
            {isAppleMobile() ? " Se non compare, controlla che la modalità Full immersion (Focus) sia spenta." : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
