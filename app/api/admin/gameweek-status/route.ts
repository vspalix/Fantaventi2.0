import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { setGameweekStatus } from "@/lib/server/test-lab";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { gameweekId?: string; status?: string };
    if (!body.gameweekId || !body.status) {
      return NextResponse.json({ error: "Mancano gameweekId e status." }, { status: 400 });
    }
    const gameweek = await setGameweekStatus(user.id, body.gameweekId, body.status);
    return NextResponse.json({ gameweek });
  } catch (error) {
    return apiError("API /api/admin/gameweek-status (POST)", error);
  }
}
