import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadLoadedVotes } from "@/lib/server/loaded-votes";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const gameweekId = new URL(request.url).searchParams.get("gameweekId") ?? "";
    if (!gameweekId) {
      return NextResponse.json({ error: "Serve la giornata." }, { status: 400 });
    }
    const sheet = await loadLoadedVotes(user.id, gameweekId);
    return NextResponse.json(sheet);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
