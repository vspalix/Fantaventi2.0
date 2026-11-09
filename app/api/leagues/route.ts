import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { createLeague, listLeaguesForUser, listPublicLeagues } from "@/lib/server/leagues";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const leagues = await listLeaguesForUser(user.id);
    const publicLeagues = await listPublicLeagues(user.id);
    return NextResponse.json({ leagues, publicLeagues });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as { name?: string; rules?: unknown };
    const league = await createLeague(user.id, user.email, body.name ?? "", body.rules);
    return NextResponse.json({ league }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
