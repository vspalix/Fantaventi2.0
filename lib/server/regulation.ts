import { buildOfficialRegulation } from "@/lib/rules/official-regulation";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getLeagueDetail } from "@/lib/server/leagues";
import { readLeagueSettings } from "@/lib/server/league-settings";

const MAX_MARKDOWN = 80_000;

export type RegulationDocument = {
  leagueId: string;
  leagueName: string;
  markdown: string;
  officialMarkdown: string;
  stored: boolean;
  schemaReady: boolean;
  updatedAt: string | null;
  canEdit: boolean;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function missingTable(message: string) {
  return /league_regulations|schema cache|could not find|relation/i.test(message);
}

async function officialFor(leagueId: string, leagueName: string) {
  const admin = createAdminSupabase();
  const { rules } = await readLeagueSettings(admin, leagueId);
  return buildOfficialRegulation(leagueName, rules);
}

export async function loadRegulation(userId: string, leagueId: string): Promise<RegulationDocument> {
  const detail = await getLeagueDetail(userId, leagueId);
  const officialMarkdown = await officialFor(leagueId, detail.name);
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("league_regulations")
    .select("body_md, updated_at")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (error) {
    if (missingTable(error.message)) {
      return {
        leagueId,
        leagueName: detail.name,
        markdown: officialMarkdown,
        officialMarkdown,
        stored: false,
        schemaReady: false,
        updatedAt: null,
        canEdit: detail.isManager,
      };
    }
    throw new Error(error.message);
  }

  const stored = typeof data?.body_md === "string" && data.body_md.trim().length > 0;
  return {
    leagueId,
    leagueName: detail.name,
    markdown: stored ? data.body_md as string : officialMarkdown,
    officialMarkdown,
    stored,
    schemaReady: true,
    updatedAt: stored ? (data.updated_at as string) : null,
    canEdit: detail.isManager,
  };
}

export async function saveRegulation(userId: string, leagueId: string, markdown: string) {
  const detail = await getLeagueDetail(userId, leagueId);
  if (!detail.isManager) throw httpError("Solo l'admin della lega può modificare il regolamento.", 403);
  const body = markdown.trim();
  if (body.length < 20) throw httpError("Il regolamento è troppo corto.", 400);
  if (body.length > MAX_MARKDOWN) throw httpError("Il regolamento supera la lunghezza ammessa.", 400);

  const admin = createAdminSupabase();
  const { error } = await admin.from("league_regulations").upsert({
    league_id: leagueId,
    body_md: body,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  }, { onConflict: "league_id" });
  if (error) {
    if (missingTable(error.message)) {
      throw httpError("Esegui regulation.sql nell'editor SQL di Supabase, poi salva di nuovo.", 409);
    }
    throw new Error(error.message);
  }
  return loadRegulation(userId, leagueId);
}

export function assertExportMarkdown(markdown: string) {
  const body = markdown.trim();
  if (body.length < 20 || body.length > MAX_MARKDOWN) {
    throw httpError("Testo del regolamento non valido.", 400);
  }
  return body;
}
