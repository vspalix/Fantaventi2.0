import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { writeAdminAudit } from "@/lib/server/audit";
import { assertServiceEnv } from "@/lib/server/catalog";
import type { LeagueRules } from "@/lib/league-rules";
import type { ScoringChoice } from "@/lib/types";
import { getLeagueDetail, updateLeague } from "@/lib/server/leagues";
import { requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const league = await getLeagueDetail(user.id, leagueId);
    return NextResponse.json({ league });
  } catch (error) {
    return apiError("API /api/leagues/[leagueId] (GET)", error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      regenerateCode?: boolean;
      startMatchday?: number;
      endMatchday?: number;
      rules?: Partial<LeagueRules>;
      scoringApply?: string;
      grantDelegateUserId?: string;
      revokeDelegateUserId?: string;
    };
    const league = await updateLeague(user.id, leagueId, body);
    if (body.rules) {
      await writeAdminAudit(user.id, {
        action: "league.rules",
        targetType: "league",
        targetId: leagueId,
        detail: { rules: body.rules, scoringApply: body.scoringApply ?? null },
      });
    }
    return NextResponse.json({ league });
  } catch (error) {
    // Non è un guasto: prima di salvare serve la scelta dell'admin su da quando valgono i bonus.
    const needsScoringChoice = (error as { scoringChoice?: ScoringChoice }).scoringChoice;
    if (needsScoringChoice) return NextResponse.json({ needsScoringChoice });
    return apiError("API /api/leagues/[leagueId] (PATCH)", error);
  }
}
