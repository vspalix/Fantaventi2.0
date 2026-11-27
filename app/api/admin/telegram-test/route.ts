import { NextResponse } from "next/server";
import { FAKE_NOTICE, realNotificationsAllowed } from "@/lib/outbound";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { reportError } from "@/lib/server/error-report";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { sendSyncTestAlert } from "@/lib/server/telegram-alert";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = await request.json().catch(() => ({})) as { kind?: unknown };
    if (body.kind === "error") {
      // Errore inventato, con dati inventati: nell'avviso devono arrivare nascosti.
      const outcome = await reportError(
        "Prova degli avvisi di errore (Laboratorio)",
        new Error("Errore finto di prova. email=mario.rossi@example.com password=segretissima telefono=3331234567"),
        { kind: "prova-avviso" },
      );
      if (outcome === "sent" || outcome === "grouped") return NextResponse.json({ ok: true, outcome });
      if (!realNotificationsAllowed()) return NextResponse.json({ ok: false, error: FAKE_NOTICE }, { status: 409 });
      return NextResponse.json({ ok: false, error: "Avviso non inviato: Telegram non ha accettato il messaggio. L'app continua a funzionare." }, { status: 502 });
    }
    const result = await sendSyncTestAlert();
    if (!result.sent) return NextResponse.json({ ok: false, error: result.reason }, { status: 502 });
    return NextResponse.json({ ok: true, warning: result.warning ?? null });
  } catch (error) {
    return apiError("API /api/admin/telegram-test (POST)", error);
  }
}
