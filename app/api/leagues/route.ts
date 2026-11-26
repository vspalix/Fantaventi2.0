import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { createLeague, listLeaguesForUser, listPublicLeagues } from "@/lib/server/leagues";
import { requireSessionUser } from "@/lib/server/session";

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const leagues = await listLeaguesForUser(user.id);
    const publicLeagues = await listPublicLeagues(user.id);
    return NextResponse.json({ leagues, publicLeagues });
  } catch (error) {
    return apiError("API /api/leagues (GET)", error);
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
    return apiError("API /api/leagues (POST)", error);
  }
}
