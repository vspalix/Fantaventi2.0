import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = await request.json().catch(() => ({})) as { leagueId?: unknown };
    const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
    const leagues = await listLeaguesForUser(user.id);
    if (!leagues.some((league) => league.id === leagueId)) {
      return NextResponse.json({ error: "Questa lega non è tra le tue squadre." }, { status: 404 });
    }
    const jar = await cookies();
    jar.set(LEAGUE_FOCUS_COOKIE, leagueId, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 400,
    });
    return NextResponse.json({ id: leagueId });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
