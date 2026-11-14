import { NextResponse } from "next/server";
import { INVITE_COOKIE } from "@/lib/invite";
import { assertServiceEnv } from "@/lib/server/catalog";
import { joinLeague, joinPublicLeague } from "@/lib/server/leagues";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

function reply(body: unknown, status = 200, clearInvite = false) {
  const response = NextResponse.json(body, { status });
  if (clearInvite) response.cookies.set(INVITE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as { code?: string; leagueId?: string };
    const league = body.leagueId
      ? await joinPublicLeague(user.id, user.email, body.leagueId)
      : await joinLeague(user.id, user.email, body.code ?? "");
    return reply({ league }, 200, !body.leagueId);
  } catch (error) {
    const message = errorMessage(error);
    const keepInvite = message.toLowerCase().includes("rosa");
    return reply({ error: message }, errorStatus(error), !keepInvite);
  }
}
