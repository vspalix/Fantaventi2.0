import { createAdminSupabase } from "@/lib/supabase/admin";

export type PushPayload = { title: string; body: string; url?: string };

function missingSchema(message: string) {
  return /schema cache|could not find|relation|does not exist/i.test(message);
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function vapidReady() {
  return Boolean(vapidPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  if (!vapidReady() || userIds.length === 0) return { sent: 0, skipped: userIds.length === 0 ? 0 : userIds.length };
  const imported = await import("web-push");
  const webpush = imported.default ?? imported;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:admin@fantaventi.local",
    process.env.VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );
  const admin = createAdminSupabase();
  const subscriptions = await admin
    .from("push_subscriptions")
    .select("endpoint, user_id, p256dh, auth_secret")
    .in("user_id", userIds);
  if (subscriptions.error) {
    if (missingSchema(subscriptions.error.message)) return { sent: 0, skipped: userIds.length };
    throw new Error(subscriptions.error.message);
  }
  let sent = 0;
  for (const row of subscriptions.data ?? []) {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint as string,
        keys: { p256dh: row.p256dh as string, auth: row.auth_secret as string },
      }, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", row.endpoint as string);
      }
    }
  }
  return { sent, skipped: (subscriptions.data ?? []).length - sent };
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
