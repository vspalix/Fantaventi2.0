import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { saveLeagueLineup } from "@/lib/server/league-hub";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";
import { meter } from "@/lib/server/telemetry";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const body = (await request.json()) as {
      gameweekId?: string;
      playerIds?: string[];
      benchIds?: string[];
      captainId?: string | null;
      viceId?: string | null;
    };
    const gameweekId = body.gameweekId;
    const playerIds = body.playerIds;
    if (!gameweekId || !Array.isArray(playerIds)) {
      return NextResponse.json({ error: "Mancano giornata o titolari." }, { status: 400 });
    }
    const benchIds = Array.isArray(body.benchIds) ? body.benchIds : [];
    const captainId = body.captainId ?? null;
    const viceId = body.viceId ?? null;
    const hub = await meter("lineup-save", () => saveLeagueLineup(user.id, leagueId, {
      gameweekId,
      playerIds,
      benchIds,
      captainId,
      viceId,
    }));
    return NextResponse.json({ hub });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
