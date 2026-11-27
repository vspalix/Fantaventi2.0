import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/server/error-report";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { pushFailure, vapidContact } from "@/lib/server/web-push-rules";

export type PushPayload = { title: string; body: string; url?: string };
/** ttlSeconds: oltre questo tempo il servizio push butta la notifica invece di consegnarla in ritardo. */
export type PushOptions = { ttlSeconds?: number; urgent?: boolean };

function missingSchema(message: string) {
  return /schema cache|could not find|relation|does not exist/i.test(message);
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function vapidReady() {
  return Boolean(vapidPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
}

/** Vero quando il server ha entrambe le chiavi per firmare le notifiche. */
export function webPushReady() {
  return vapidReady();
}

export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
  client?: SupabaseClient,
  options: PushOptions = {},
) {
  if (!vapidReady() || userIds.length === 0) return { sent: 0, skipped: userIds.length === 0 ? 0 : userIds.length, people: 0 };
  const imported = await import("web-push");
  const webpush = imported.default ?? imported;
  webpush.setVapidDetails(
    vapidContact(process.env.VAPID_SUBJECT),
    process.env.VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );
  const admin = client ?? createAdminSupabase();
  const subscriptions = await admin
    .from("push_subscriptions")
    .select("endpoint, user_id, p256dh, auth_secret")
    .in("user_id", userIds);
  if (subscriptions.error) {
    if (missingSchema(subscriptions.error.message)) return { sent: 0, skipped: userIds.length, people: 0 };
    throw new Error(subscriptions.error.message);
  }
  let sent = 0;
  let removed = 0;
  const reached = new Set<string>();
  for (const row of subscriptions.data ?? []) {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint as string,
        keys: { p256dh: row.p256dh as string, auth: row.auth_secret as string },
      }, JSON.stringify(payload), {
        ...(options.ttlSeconds !== undefined ? { TTL: Math.max(0, Math.floor(options.ttlSeconds)) } : {}),
        ...(options.urgent ? { urgency: "high" as const } : {}),
      });
      sent += 1;
      reached.add(row.user_id as string);
    } catch (error) {
      const failure = pushFailure(row.endpoint as string, error);
      if (failure.gone) {
        const deleted = await admin.from("push_subscriptions").delete().eq("endpoint", row.endpoint as string);
        if (deleted.error) void reportError("Notifiche: iscrizione non valida non eliminata", new Error(deleted.error.message));
        else removed += 1;
      }
      // L'errore originale contiene l'indirizzo del dispositivo: si segnala solo il riassunto.
      void reportError("Notifiche: invio non riuscito", new Error(failure.summary));
    }
  }
  /** people: persone raggiunte su almeno un dispositivo. */
  return { sent, skipped: (subscriptions.data ?? []).length - sent, removed, people: reached.size };
}

export async function sendPushToEveryone(payload: PushPayload) {
  if (!vapidReady()) return { sent: 0, skipped: 0, ready: false };
  const admin = createAdminSupabase();
  const subscriptions = await admin.from("push_subscriptions").select("user_id");
  if (subscriptions.error) {
    if (missingSchema(subscriptions.error.message)) return { sent: 0, skipped: 0, ready: true };
    throw new Error(subscriptions.error.message);
  }
  const userIds = [...new Set((subscriptions.data ?? []).map((row) => row.user_id as string))];
  const result = await sendPushToUsers(userIds, payload);
  return { ...result, ready: true };
}
