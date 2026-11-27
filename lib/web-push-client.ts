"use client";

/**
 * Notifiche web nel browser: stato del dispositivo, attivazione e prova.
 * Le usa l'interruttore «Notifiche» in Account.
 */

export type PushState =
  | "loading"
  /** Dentro l'app installata dagli store: lì valgono le notifiche native. */
  | "native"
  /** iPhone o iPad in Safari: serve prima «Aggiungi alla schermata Home». */
  | "ios-browser"
  /** iPhone aperto dall'icona ma con iOS troppo vecchio (prima della 16.4). */
  | "ios-old"
  | "unsupported"
  | "denied"
  | "off"
  | "on";

/** Avvisa le altre parti della pagina che lo stato è cambiato. */
export const PUSH_CHANGED_EVENT = "fv-push-changed";

export function isAppleMobile() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function isNativeApp() {
  const bridge = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return bridge?.isNativePlatform?.() === true;
}

function browserCanPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function readPushState(): Promise<PushState> {
  if (isNativeApp()) return "native";
  if (isAppleMobile() && !isStandalone()) return "ios-browser";
  if (!browserCanPush()) return isAppleMobile() ? "ios-old" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  try {
    return (await currentSubscription()) ? "on" : "off";
  } catch {
    return "off";
  }
}

async function saveOnServer(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Notifiche non attivate. Riprova tra poco.");
}

function keyBytes(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, key: Uint8Array) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((value, index) => value === key[index]);
}

/**
 * Da chiamare subito al tocco del pulsante: su iPhone la richiesta di permesso
 * deve partire dal tocco, prima di ogni altra attesa.
 */
export async function enablePush(): Promise<PushState> {
  if (!browserCanPush()) return readPushState();
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";

  const keyResponse = await fetch("/api/push/subscribe");
  const keyBody = (await keyResponse.json().catch(() => ({}))) as { publicKey?: string | null };
  if (!keyBody.publicKey) throw new Error("Le notifiche non sono ancora pronte sul server. Riprova più tardi.");
  const key = keyBytes(keyBody.publicKey);

  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveOnServer(subscription);
  window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
  return "on";
}

/** Ricorda al server l'iscrizione di questo dispositivo (per esempio dopo un cambio di account). */
export async function refreshPushOnServer() {
  const subscription = await currentSubscription();
  if (subscription) await saveOnServer(subscription);
}

/** Spegne le notifiche su questo dispositivo: toglie l'iscrizione dal browser e dal server. */
export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription) {
    const response = await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Notifiche non disattivate. Riprova tra poco.");
    await subscription.unsubscribe().catch(() => undefined);
  }
  window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
  return readPushState();
}
