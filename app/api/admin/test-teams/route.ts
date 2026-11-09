import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { generateTestTeams } from "@/lib/server/test-lab";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = (await request.json()) as { leagueId?: string };
    if (!body.leagueId) return NextResponse.json({ error: "Manca leagueId." }, { status: 400 });
    const teams = await generateTestTeams(user.id, body.leagueId);
    return NextResponse.json({ teams });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
