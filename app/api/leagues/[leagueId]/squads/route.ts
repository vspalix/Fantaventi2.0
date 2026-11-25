import { NextResponse } from "next/server";
import { loadLeagueSquads } from "@/lib/server/league-hub";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const gameweek = Number(new URL(request.url).searchParams.get("gameweek") ?? "0");
    const squads = await loadLeagueSquads(
      user.id,
      leagueId,
      Number.isInteger(gameweek) && gameweek > 0 ? gameweek : undefined,
    );
    return NextResponse.json({ squads });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
