import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadRegulation, saveRegulation } from "@/lib/server/regulation";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    return NextResponse.json(await loadRegulation(user.id, leagueId));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const body = (await request.json()) as { markdown?: string };
    if (typeof body.markdown !== "string") {
      return NextResponse.json({ error: "Manca il testo del regolamento." }, { status: 400 });
    }
    return NextResponse.json(await saveRegulation(user.id, leagueId, body.markdown));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
