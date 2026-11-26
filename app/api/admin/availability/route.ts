import { NextResponse } from "next/server";
import type { AvailabilityStatus } from "@/lib/availability-providers";
import {
  readAvailabilitySettings,
  saveAvailabilityAlias,
  saveAvailabilitySettings,
  importNamedAvailability,
  saveManualAvailability,
  searchPlayers,
  syncAvailability,
} from "@/lib/server/availability";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/server/platform-role";

const STATUSES = new Set<AvailabilityStatus>(["available", "starter", "bench", "doubt", "injured", "suspended"]);

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    if (query) return NextResponse.json({ players: await searchPlayers(query) });
    const current = await readAvailabilitySettings();
    const ids = [...new Set(current.settings.aliases.map((alias) => alias.playerId))];
    const aliasNames: Record<string, string> = {};
    if (ids.length > 0) {
      const names = await createAdminSupabase().from("players").select("id, full_name").in("id", ids);
      if (!names.error) {
        for (const row of names.data ?? []) aliasNames[row.id as string] = row.full_name as string;
      }
    }
    return NextResponse.json({ ...current, aliasNames });
  } catch (error) {
    return apiError("API /api/admin/availability (GET)", error);
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = await request.json() as {
      action?: string;
      provider?: "api-football" | "fantacalcio" | "external-json" | "manual";
      leagueId?: number;
      season?: number;
      jsonUrl?: string;
      playerId?: string;
      status?: AvailabilityStatus;
      playProbability?: number | null;
      reason?: string | null;
      name?: string;
      club?: string;
      rows?: { playerId: string; status: AvailabilityStatus; playProbability?: number | null; reason?: string | null }[];
    };
    if (body.action === "sync") return NextResponse.json(await syncAvailability(true));
    if (body.action === "settings") {
      return NextResponse.json({ settings: await saveAvailabilitySettings({
        provider: body.provider,
        leagueId: Number(body.leagueId),
        season: Number(body.season),
        jsonUrl: body.jsonUrl ?? "",
      }) });
    }
    if (body.action === "alias" && body.playerId && body.name && body.club) {
      await saveAvailabilityAlias({ name: body.name, club: body.club, playerId: body.playerId });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "manual" && body.playerId && body.status && STATUSES.has(body.status)) {
      const matchday = await saveManualAvailability({
        playerId: body.playerId,
        status: body.status,
        playProbability: body.playProbability ?? null,
        reason: body.reason ?? null,
      });
      return NextResponse.json({ ok: true, matchday });
    }
    if (body.action === "upload" && Array.isArray(body.rows)) {
      return NextResponse.json(await importNamedAvailability(body.rows.flatMap((row) => {
        const named = row as { name?: string; club?: string; status?: AvailabilityStatus; playProbability?: number | null; reason?: string | null };
        if (!named.name || !named.club || !named.status || !STATUSES.has(named.status)) return [];
        return [{ name: named.name, club: named.club, status: named.status, playProbability: named.playProbability ?? null, reason: named.reason ?? null }];
      })));
    }
    if (body.action === "import" && Array.isArray(body.rows)) {
      let written = 0;
      for (const row of body.rows.slice(0, 200)) {
        if (!row.playerId || !row.status || !STATUSES.has(row.status)) continue;
        await saveManualAvailability({
          playerId: row.playerId,
          status: row.status,
          playProbability: row.playProbability ?? null,
          reason: row.reason ?? null,
        });
        written += 1;
      }
      return NextResponse.json({ written });
    }
    return NextResponse.json({ error: "Azione non riconosciuta." }, { status: 400 });
  } catch (error) {
    return apiError("API /api/admin/availability (POST)", error);
  }
}
