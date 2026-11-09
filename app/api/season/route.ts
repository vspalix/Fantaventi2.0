import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertServiceEnv, getCurrentSeason, SEASON_COOKIE } from "@/lib/server/catalog";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const body = await request.json().catch(() => ({})) as { seasonId?: unknown };
    const seasonId = typeof body.seasonId === "string" ? body.seasonId : "";
    if (!seasonId) {
      return NextResponse.json({ error: "Scegli una stagione." }, { status: 400 });
    }
    const season = await getCurrentSeason(createAdminSupabase(), seasonId);
    if (season.status !== "running" && season.status !== "open") {
      return NextResponse.json({ error: "Questa stagione non è selezionabile." }, { status: 409 });
    }
    const jar = await cookies();
    jar.set(SEASON_COOKIE, season.id, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 400,
    });
    return NextResponse.json({
      id: season.id,
      code: season.code,
      competitionId: season.competitionId,
      competitionCode: season.competitionCode,
      competitionName: season.competitionName,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
