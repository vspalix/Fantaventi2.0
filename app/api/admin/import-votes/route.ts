import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { importEmergencyVotes } from "@/lib/server/emergency-votes";
import { importVotes } from "@/lib/server/import-votes";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { gameweekId?: string; provider?: string; votes?: unknown; replace?: boolean };
      if (!body.gameweekId) {
        return NextResponse.json({ error: "Manca la giornata." }, { status: 400 });
      }
      const result = await importVotes(user.id, {
        gameweekId: body.gameweekId,
        provider: body.provider || "serie-a-api-votes",
        source: { json: body.votes ?? body },
        replace: body.replace === true,
        superAdmin: true,
      });
      return NextResponse.json(result);
    }
    const form = await request.formData();
    const file = form.get("file");
    const gameweekId = String(form.get("gameweekId") ?? "");
    const provider = String(form.get("provider") ?? "");
    if (!(file instanceof File) || !gameweekId) {
      return NextResponse.json({ error: "Servono il file voti e la giornata." }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const emergency = provider === "emergency-votes" || /\.(json|csv)$/i.test(file.name);
    if (emergency) {
      const result = await importEmergencyVotes(gameweekId, file.name, bytes.toString("utf8"));
      return NextResponse.json(result);
    }
    const result = await importVotes(user.id, {
      gameweekId,
      provider,
      replace: form.get("replace") === "1",
      superAdmin: true,
      source: { fileName: file.name, bytes },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
