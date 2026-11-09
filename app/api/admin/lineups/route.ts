import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { meter } from "@/lib/server/telemetry";
import { loadAdminLineups, setAdminLineups } from "@/lib/server/test-lab";

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
    const lineups = await loadAdminLineups(user.id, leagueId, gameweekId);
    return NextResponse.json({ lineups });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as {
      leagueId?: string;
      gameweekId?: string;
      fantasyTeamId?: string;
      filed?: boolean;
    };
    const leagueId = body.leagueId;
    const gameweekId = body.gameweekId;
    const filed = body.filed;
    const fantasyTeamId = body.fantasyTeamId;
    if (!leagueId || !gameweekId || typeof filed !== "boolean") {
      return NextResponse.json({ error: "Servono lega, giornata e se schierare o togliere." }, { status: 400 });
    }
    const result = await meter("lineup-save", () => setAdminLineups(user.id, leagueId, gameweekId, filed, fantasyTeamId));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
