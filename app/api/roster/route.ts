import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { assertServiceEnv } from "@/lib/server/catalog";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { loadRoster, saveRoster } from "@/lib/server/roster";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";
import { meter } from "@/lib/server/telemetry";

async function focusedLeague(userId: string, requested?: string) {
  const leagues = await listLeaguesForUser(userId);
  const saved = requested || (await cookies()).get(LEAGUE_FOCUS_COOKIE)?.value || "";
  return leagues.find((league) => league.id === saved) ?? leagues[0] ?? null;
}

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const league = await focusedLeague(user.id);
    const roster = league
      ? await meter("roster", () => loadRoster(user.id, league.id))
      : { teamId: null, teamName: "", playerIds: [] as string[], appliesFrom: 1, market: { locked: false, gameweekNumber: null, message: null } };
    return NextResponse.json({ roster, leagueId: league?.id ?? null });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as { teamName?: string; playerIds?: string[]; leagueId?: string };
    const league = await focusedLeague(user.id, body.leagueId);
    if (!league) {
      return NextResponse.json({ error: "Entra in una lega: la rosa appartiene a quella lega." }, { status: 409 });
    }
    const roster = await saveRoster(user.id, user.email, body.teamName ?? "", body.playerIds ?? [], league.id);
    return NextResponse.json({ roster });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
