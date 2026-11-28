import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv, getCurrentSeason } from "@/lib/server/catalog";
import { createLeague, listLeaguesForUser, listPublicLeagues, seasonCalendar } from "@/lib/server/leagues";
import { requireSessionUser } from "@/lib/server/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const params = new URL(request.url).searchParams;
    const wanted = { search: params.get("q") ?? "", offset: Number(params.get("offset") ?? 0) };
    // Cercando o sfogliando le leghe pubbliche non serve rileggere il resto.
    if (params.has("q") || params.has("offset")) {
      const page = await listPublicLeagues(user.id, undefined, wanted);
      return NextResponse.json({ publicLeagues: page.leagues, publicNext: page.next });
    }
    const own = listLeaguesForUser(user.id);
    const admin = createAdminSupabase();
    const [leagues, page, calendar] = await Promise.all([
      own,
      listPublicLeagues(user.id, own),
      getCurrentSeason(admin).then((season) => seasonCalendar(admin, season.id)),
    ]);
    return NextResponse.json({ leagues, publicLeagues: page.leagues, publicNext: page.next, calendar });
  } catch (error) {
    return apiError("API /api/leagues (GET)", error);
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as { name?: string; rules?: unknown; startMatchday?: unknown; endMatchday?: unknown };
    // Senza una giornata di inizio la lega non si crea: va scelta.
    const league = await createLeague(user.id, user.email, body.name ?? "", body.rules, {
      startMatchday: body.startMatchday ?? null,
      endMatchday: body.endMatchday,
    });
    return NextResponse.json({ league }, { status: 201 });
  } catch (error) {
    return apiError("API /api/leagues (POST)", error);
  }
}
