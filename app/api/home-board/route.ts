import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadHomeBoard } from "@/lib/server/home-board";
import { requireSessionUser } from "@/lib/server/session";

/** La Dashboard di una delle proprie leghe, da tenere pronta sul dispositivo. Sola lettura. */
export async function GET(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const leagueId = new URL(request.url).searchParams.get("league")?.trim() ?? "";
    if (!leagueId) return NextResponse.json({ error: "Manca la lega." }, { status: 400 });
    const board = await loadHomeBoard(user.id, leagueId);
    return NextResponse.json({ board }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError("API /api/home-board (GET)", error);
  }
}
