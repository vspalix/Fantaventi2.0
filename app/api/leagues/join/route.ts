import { NextResponse } from "next/server";
import { INVITE_COOKIE } from "@/lib/invite";
import { assertServiceEnv } from "@/lib/server/catalog";
import { joinLeague, joinPublicLeague, joinRosterOffer } from "@/lib/server/leagues";
import { publicError } from "@/lib/server/api-error";
import { requireSessionUser } from "@/lib/server/session";
import type { RosterImportSource } from "@/lib/types";

function reply(body: unknown, status = 200, clearInvite = false) {
  const response = NextResponse.json(body, { status });
  if (clearInvite) response.cookies.set(INVITE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as {
      code?: string;
      leagueId?: string;
      confirmed?: boolean;
      importFromLeagueId?: string | null;
    };
    if (!body.confirmed) {
      const offer = await joinRosterOffer(user.id, { code: body.code, leagueId: body.leagueId });
      if (offer.needed) {
        return reply({
          needsImport: true,
          targetName: offer.targetName,
          sources: offer.sources satisfies RosterImportSource[],
        });
      }
    }
    const league = body.leagueId
      ? await joinPublicLeague(user.id, user.email, body.leagueId, body.importFromLeagueId ?? null)
      : await joinLeague(user.id, user.email, body.code ?? "", body.importFromLeagueId ?? null);
    return reply({ league }, 200, !body.leagueId);
  } catch (error) {
    const { message, status } = publicError("API /api/leagues/join (POST)", error);
    const keepInvite = message.toLowerCase().includes("rosa") || message.toLowerCase().includes("calciatori");
    return reply({ error: message }, status, !keepInvite);
  }
}
