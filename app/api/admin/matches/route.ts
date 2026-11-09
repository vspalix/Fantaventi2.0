import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { listGameweekMatches, setMatchResult } from "@/lib/server/serie-a-calendar";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const gameweekId = new URL(request.url).searchParams.get("gameweekId") ?? "";
    if (!gameweekId) return NextResponse.json({ error: "Manca la giornata." }, { status: 400 });
    const result = await listGameweekMatches(user.id, gameweekId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as {
      matchId?: string;
      gameweekId?: string;
      status?: "scheduled" | "finished";
      homeGoals?: number | null;
      awayGoals?: number | null;
    };
    if (body.status !== "scheduled" && body.status !== "finished") {
      return NextResponse.json({ error: "Lo stato è in programma oppure finita." }, { status: 400 });
    }
    const result = await setMatchResult(user.id, {
      matchId: body.matchId,
      gameweekId: body.gameweekId,
      status: body.status,
      homeGoals: body.homeGoals,
      awayGoals: body.awayGoals,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
