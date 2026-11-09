import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { importQuotations } from "@/lib/server/import-quotations";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const form = await request.formData();
    const file = form.get("file");
    const competitionId = String(form.get("competitionId") ?? "");
    const seasonId = String(form.get("seasonId") ?? "");
    const provider = String(form.get("provider") ?? "");
    if (!(file instanceof File) || !competitionId || !seasonId) {
      return NextResponse.json({ error: "Servono il file, la competizione e la stagione." }, { status: 400 });
    }
    const result = await importQuotations(user.id, {
      competitionId,
      seasonId,
      provider,
      source: { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
