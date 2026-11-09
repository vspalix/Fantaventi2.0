import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadRoster, saveRoster } from "@/lib/server/roster";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";
import { meter } from "@/lib/server/telemetry";

export async function GET() {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const roster = await meter("roster", () => loadRoster(user.id));
    return NextResponse.json({ roster });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as { teamName?: string; playerIds?: string[] };
    const roster = await saveRoster(user.id, user.email, body.teamName ?? "", body.playerIds ?? []);
    return NextResponse.json({ roster });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
