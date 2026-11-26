import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { loadLoadedVotes } from "@/lib/server/loaded-votes";
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
    return apiError("API /api/admin/loaded-votes (GET)", error);
  }
}
