import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { importFreshTestVotes } from "@/lib/server/simulate-gameweek";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { leagueId?: string; gameweekId?: string };
    if (!body.leagueId || !body.gameweekId) {
      return NextResponse.json({ error: "Servono la lega e la giornata." }, { status: 400 });
    }
    const result = await importFreshTestVotes(user.id, {
      leagueId: body.leagueId,
      gameweekId: body.gameweekId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError("API /api/admin/test-votes (POST)", error);
  }
}
