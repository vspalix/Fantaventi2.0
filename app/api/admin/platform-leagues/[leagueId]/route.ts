import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import type { LeagueRules } from "@/lib/league-rules";
import { unlockLeagueLineups } from "@/lib/server/platform-control";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { updateLeague } from "@/lib/server/leagues";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const { leagueId } = await context.params;
    const body = (await request.json()) as {
      rules?: Partial<LeagueRules>;
      name?: string;
      grantDelegateUserId?: string;
      revokeDelegateUserId?: string;
      unlockGameweekId?: string;
    };
    const league = body.rules || body.name || body.grantDelegateUserId || body.revokeDelegateUserId
      ? await updateLeague(user.id, leagueId, body)
      : null;
    const unlocked = body.unlockGameweekId
      ? await unlockLeagueLineups(leagueId, body.unlockGameweekId)
      : null;
    return NextResponse.json({ league, unlocked });
  } catch (error) {
    return apiError("API /api/admin/platform-leagues/[leagueId] (PATCH)", error);
  }
}
