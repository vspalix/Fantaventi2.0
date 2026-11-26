import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { loadCatalog } from "@/lib/server/catalog";
import { loadLeagueRosters } from "@/lib/server/league-hub";
import { requireSessionUser } from "@/lib/server/session";

export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const gameweek = Number(new URL(request.url).searchParams.get("gameweek") ?? "0");
    const catalog = await loadCatalog();
    const others = await loadLeagueRosters(
      user.id,
      leagueId,
      Number.isInteger(gameweek) && gameweek > 0 ? gameweek : 1,
      catalog.players,
    );
    return NextResponse.json(others);
  } catch (error) {
    return apiError("API /api/leagues/[leagueId]/others (GET)", error);
  }
}
