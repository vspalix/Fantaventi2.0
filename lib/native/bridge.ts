export type SharePayload = {
  title: string;
  text?: string;
  url?: string;
};

export type ShareResult = "shared" | "copied" | "cancelled" | "unavailable";

export type PushRegistration = {
  registered: boolean;
  reason?: string;
};

function shareLine(payload: SharePayload) {
  return [payload.text, payload.url].filter(Boolean).join("\n") || payload.title;
}

function cancelled(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  return name === "AbortError" || /cancel/i.test(message);
}

export async function nativeShare(payload: SharePayload): Promise<ShareResult> {
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
        dialogTitle: payload.title,
      });
      return "shared";
    } catch (error) {
      if (cancelled(error)) return "cancelled";
      throw error;
    }
  }

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: payload.title, text: payload.text, url: payload.url });
      return "shared";
    } catch (error) {
      if (cancelled(error)) return "cancelled";
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(shareLine(payload));
    return "copied";
  }

  return "unavailable";
}

export async function shareJoinCode(code: string) {
  const result = await nativeShare({
    title: "Codice invito FantaVenti",
    text: `Codice invito: ${code}`,
  });
  if (result === "shared" || result === "copied") void triggerHaptic();
  return result;
}

export async function triggerHaptic() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Il feedback aptico è facoltativo: un dispositivo senza motore non blocca l'azione.
  }
}

let pushRegistration: Promise<PushRegistration> | null = null;

export function registerNativePush() {
  pushRegistration ??= registerNativePushOnce();
  return pushRegistration;
}

async function registerNativePushOnce(): Promise<PushRegistration> {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return { registered: false };
  const platform = Capacitor.getPlatform();
  if (platform !== "ios" && platform !== "android") return { registered: false };

  const { PushNotifications } = await import("@capacitor/push-notifications");
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") return { registered: false, reason: "denied" };

  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new Error("Timeout registrazione push."))), 15000);
    const handles: Array<{ remove: () => Promise<void> }> = [];
    let settled = false;
    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void Promise.all(handles.map((handle) => handle.remove())).catch(() => undefined);
      action();
    }
    void PushNotifications.addListener("registration", (event) => {
      finish(() => resolve(event.value));
    }).then((handle) => handles.push(handle));
    void PushNotifications.addListener("registrationError", (error) => {
      finish(() => reject(new Error(error.error || "Registrazione push non riuscita.")));
    }).then((handle) => handles.push(handle));
    void PushNotifications.register();
  });

  const response = await fetch("/api/push/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) return { registered: false, reason: body.error ?? "Salvataggio token non riuscito." };
  return { registered: true };
}
