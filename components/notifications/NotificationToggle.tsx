"use client";

import { useEffect, useState } from "react";
import { readableError } from "@/lib/feedback";
import { disablePush, enablePush, PUSH_CHANGED_EVENT, readPushState, type PushState } from "@/lib/web-push-client";

const HIDDEN: PushState[] = ["native", "ios-browser", "ios-old", "unsupported"];

/** Interruttore «Notifiche» in Account, per il dispositivo in uso. */
export function NotificationToggle() {
  const [state, setState] = useState<PushState>("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function toggle(on: boolean) {
    setPending(true);
    setError(null);
    try {
      const next = on ? await enablePush() : await disablePush();
      setState(next);
      if (on && next === "denied") setError("Notifiche bloccate: consentile nelle impostazioni del telefono.");
    } catch (reason) {
      setError(readableError(reason, on ? "Notifiche non attivate. Riprova tra poco." : "Notifiche non disattivate. Riprova tra poco."));
      setState(await readPushState());
    } finally {
      setPending(false);
    }
  }

  if (HIDDEN.includes(state)) return null;
  return (
    <section className="card stack ac-notify">
      <label className="lg-switch">
        <span className="lg-choice-text"><strong>Ricevi notifiche</strong></span>
        <input
          type="checkbox"
          role="switch"
          checked={state === "on"}
          disabled={pending || state === "loading"}
          onChange={(event) => void toggle(event.target.checked)}
        />
      </label>
      {error ? <p className="banner">{error}</p> : null}
    </section>
  );
}
