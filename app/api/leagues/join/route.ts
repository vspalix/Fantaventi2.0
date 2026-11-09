import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { joinLeague, joinPublicLeague } from "@/lib/server/leagues";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as { code?: string; leagueId?: string };
    const league = body.leagueId
      ? await joinPublicLeague(user.id, user.email, body.leagueId)
      : await joinLeague(user.id, user.email, body.code ?? "");
    return NextResponse.json({ league });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
