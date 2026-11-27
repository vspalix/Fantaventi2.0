import { after, NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSessionUser } from "@/lib/server/session";
import { countPushDevices, sendPushToUsers, webPushReady } from "@/lib/server/web-push";
import { createAdminSupabase } from "@/lib/supabase/admin";

/** Attesa prima dell'invio: il tempo di uscire dall'app e vedere la notifica arrivare. */
const DELAY_MS = 8_000;
/** Al massimo una prova ogni 30 secondi per persona (per copia dell'app). */
const PAUSE_MS = 30_000;
const lastTest = new Map<string, number>();

/** Manda una notifica di prova solo ai dispositivi di chi la chiede. */
export async function POST() {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    if (!webPushReady()) {
      return NextResponse.json({ error: "Le notifiche non sono ancora pronte sul server." }, { status: 409 });
    }
    const now = Date.now();
    const previous = lastTest.get(user.id) ?? 0;
    if (now - previous < PAUSE_MS) {
      const seconds = Math.ceil((PAUSE_MS - (now - previous)) / 1000);
      return NextResponse.json({ error: `Hai appena mandato una prova. Riprova tra ${seconds} secondi.` }, { status: 429 });
    }

    const admin = createAdminSupabase();
    const devices = await countPushDevices(user.id, admin);
    if (devices === 0) {
      return NextResponse.json({
        error: "Nessun tuo dispositivo riceve le notifiche. Premi prima «Attiva notifiche» su questo dispositivo.",
      }, { status: 404 });
    }
    lastTest.set(user.id, now);

    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      await sendPushToUsers([user.id], {
        title: "FantaVenti: prova riuscita",
        body: "Se leggi questo messaggio, le notifiche funzionano su questo dispositivo.",
        url: "/account#notifiche",
      }, admin, { ttlSeconds: 600, urgent: true });
    });

    const where = devices === 1 ? "sul tuo dispositivo" : `sui tuoi ${devices} dispositivi`;
    return NextResponse.json({
      ok: true,
      devices,
      message: `Prova in arrivo ${where} tra circa ${Math.round(DELAY_MS / 1000)} secondi. Puoi uscire dall'app per vederla comparire.`,
    });
  } catch (error) {
    return apiError("API /api/push/test (POST)", error);
  }
}
