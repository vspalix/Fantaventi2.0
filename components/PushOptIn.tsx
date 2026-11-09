"use client";

import { useState } from "react";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function PushOptIn() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function enable() {
    setPending(true);
    setMessage(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setMessage("Questo browser non riceve le notifiche push.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Permesso notifiche non concesso.");
        return;
      }
      const keyResponse = await fetch("/api/push/subscribe");
      const keyBody = (await keyResponse.json()) as { publicKey?: string | null; error?: string };
      if (!keyBody.publicKey) {
        setMessage("Il server non ha ancora la chiave pubblica delle notifiche.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey),
      });
      const json = subscription.toJSON();
      const saved = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      const body = (await saved.json()) as { error?: string };
      if (!saved.ok) throw new Error(body.error ?? "Iscrizione non riuscita.");
      setMessage("Notifiche attive su questo dispositivo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notifiche non attivate.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="row">
      <button className="ghost" type="button" disabled={pending} onClick={() => void enable()}>Attiva notifiche</button>
      {message ? <span className="small muted">{message}</span> : null}
    </div>
  );
}
