import { createAdminSupabase } from "@/lib/supabase/admin";

function missingSchema(message: string) {
  return /schema cache|could not find|relation|does not exist/i.test(message);
}

export async function writeLeagueFeed(input: {
  leagueId: string;
  gameweekId?: string | null;
  kind: "mercato" | "risultati" | "badge" | "ribaltone";
  body: string;
  payload?: Record<string, unknown>;
}) {
  const admin = createAdminSupabase();
  const inserted = await admin.from("league_feed").insert({
    league_id: input.leagueId,
    gameweek_id: input.gameweekId ?? null,
    kind: input.kind,
    body: input.body,
    payload: input.payload ?? {},
  });
  if (inserted.error && !missingSchema(inserted.error.message)) throw new Error(inserted.error.message);
}

export async function recordMarketFeed(input: {
  userId: string;
  teamId: string;
  seasonId: string;
  beforeIds: string[];
  playerIds: string[];
  afterMatchday: number;
}) {
  const removed = input.beforeIds.filter((id) => !input.playerIds.includes(id));
  const added = input.playerIds.filter((id) => !input.beforeIds.includes(id));
  if (removed.length === 0 && added.length === 0) return;
  const admin = createAdminSupabase();
  const profile = await admin.from("profiles").select("display_name").eq("id", input.userId).maybeSingle();
  const name = (profile.data?.display_name as string | undefined) ?? "Un allenatore";
  const ids = [...new Set([...removed, ...added])];
  const people = ids.length
    ? await admin.from("players").select("id, full_name").in("id", ids)
    : { data: [], error: null };
  if (people.error) return;
  const label = new Map((people.data ?? []).map((row) => [row.id as string, row.full_name as string]));
  const left = removed.map((id) => label.get(id) ?? "un calciatore").slice(0, 3).join(", ");
  const joined = added.map((id) => label.get(id) ?? "un calciatore").slice(0, 3).join(", ");
  const body = left && joined
    ? `${name} al checkpoint dopo la giornata ${input.afterMatchday}: fuori ${left}, dentro ${joined}.`
    : `${name} ha fatto ${Math.max(removed.length, added.length)} cambi al checkpoint dopo la giornata ${input.afterMatchday}.`;
  const memberships = await admin.from("private_league_members").select("private_league_id").eq("fantasy_team_id", input.teamId);
  if (memberships.error) return;
  for (const row of memberships.data ?? []) {
    await writeLeagueFeed({
      leagueId: row.private_league_id as string,
      kind: "mercato",
      body,
      payload: { afterMatchday: input.afterMatchday, teamId: input.teamId },
    });
  }
}

export async function listLeagueFeed(leagueId: string) {
  const admin = createAdminSupabase();
  const feed = await admin
    .from("league_feed")
    .select("id, kind, body, payload, created_at, gameweek_id")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (feed.error) {
    if (missingSchema(feed.error.message)) return { ready: false, items: [], badges: [] };
    throw new Error(feed.error.message);
  }
  const badges = await admin
    .from("league_badges")
    .select("id, kind, title, detail, gameweek_id, created_at")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (badges.error && !missingSchema(badges.error.message)) throw new Error(badges.error.message);
  return {
    ready: true,
    items: feed.data ?? [],
    badges: badges.data ?? [],
  };
}
