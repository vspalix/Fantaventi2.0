import { NextResponse } from "next/server";
import { correctListoneRole, loadListone } from "@/lib/server/listone-view";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const url = new URL(request.url);
    const listone = await loadListone(
      user.id,
      url.searchParams.get("competition") ?? "",
      url.searchParams.get("season") ?? "",
    );
    return NextResponse.json(listone);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function PATCH(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { registrationId?: string; role?: "P" | "D" | "C" | "A" };
    if (!body.registrationId || !body.role) {
      return NextResponse.json({ error: "Servono calciatore e ruolo." }, { status: 400 });
    }
    const player = await correctListoneRole(user.id, body.registrationId, body.role);
    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
