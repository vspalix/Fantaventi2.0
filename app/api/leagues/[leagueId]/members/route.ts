import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { writeAdminAudit } from "@/lib/server/audit";
import { assertServiceEnv } from "@/lib/server/catalog";
import { removeParticipant } from "@/lib/server/leagues";
import { requireSessionUser } from "@/lib/server/session";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const body = (await request.json()) as { fantasyTeamId?: string };
    if (!body.fantasyTeamId) {
      return NextResponse.json({ error: "Manca la squadra da rimuovere." }, { status: 400 });
    }
    const league = await removeParticipant(user.id, leagueId, body.fantasyTeamId);
    await writeAdminAudit(user.id, {
      action: "league.expel",
      targetType: "league",
      targetId: leagueId,
      detail: { fantasyTeamId: body.fantasyTeamId },
    });
    return NextResponse.json({ league });
  } catch (error) {
    return apiError("API /api/leagues/[leagueId]/members (DELETE)", error);
  }
}
