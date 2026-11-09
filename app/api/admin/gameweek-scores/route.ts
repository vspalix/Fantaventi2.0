import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { loadGameweekScores } from "@/lib/server/test-lab";

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const url = new URL(request.url);
    const leagueId = url.searchParams.get("leagueId") ?? "";
    const gameweekId = url.searchParams.get("gameweekId") ?? "";
    if (!leagueId || !gameweekId) {
      return NextResponse.json({ error: "Servono lega e giornata." }, { status: 400 });
    }
    const board = await loadGameweekScores(user.id, leagueId, gameweekId);
    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
