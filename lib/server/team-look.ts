import { cookies } from "next/headers";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { moderateImage, moderateText } from "@/lib/moderation";
import { ensureLeagueTeam, listLeaguesForUser } from "@/lib/server/leagues";
import { reportError, reportUnlessMissing } from "@/lib/server/error-report";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type TeamLook = {
  teamId: string | null;
  name: string;
  primary: string;
  secondary: string;
  logoUrl: string;
};

const DEFAULT_PRIMARY = "#c6f531";
const DEFAULT_SECONDARY = "#f4f4f5";

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function hex(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function keyOf(teamId: string) {
  return `team-look:${teamId}`;
}

export async function readTeamLook(teamId: string | null, name: string): Promise<TeamLook> {
  const base: TeamLook = { teamId, name, primary: DEFAULT_PRIMARY, secondary: DEFAULT_SECONDARY, logoUrl: "" };
  if (!teamId) return base;
  try {
    const admin = createAdminSupabase();
    const row = await admin.from("app_settings").select("value").eq("key", keyOf(teamId)).maybeSingle();
    if (row.error) reportUnlessMissing("Colori della squadra", new Error(row.error.message));
    if (row.error || !row.data) return base;
    const value = (row.data.value ?? {}) as { primary?: unknown; secondary?: unknown; logoUrl?: unknown };
    return {
      ...base,
      primary: hex(value.primary, DEFAULT_PRIMARY),
      secondary: hex(value.secondary, DEFAULT_SECONDARY),
      logoUrl: typeof value.logoUrl === "string" ? value.logoUrl : "",
    };
  } catch (error) {
    void reportError("Colori della squadra", error);
    return base;
  }
}

export async function saveTeamLook(
  userId: string,
  input: { name: string; primary: string; secondary: string; logo?: { bytes: Buffer; mime: string } | null },
) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 28) throw httpError("Il nome squadra deve avere tra 2 e 28 caratteri.", 400);
  const text = moderateText(name);
  if (text) throw httpError(text, 400);
  const primary = hex(input.primary, "");
  const secondary = hex(input.secondary, "");
  if (!primary || !secondary) throw httpError("I colori sociali vanno indicati come codice esadecimale.", 400);
  if (input.logo) {
    const image = moderateImage(input.logo.bytes, input.logo.mime);
    if (image) throw httpError(image, 400);
  }

  const admin = createAdminSupabase();
  const focusedId = (await cookies()).get(LEAGUE_FOCUS_COOKIE)?.value;
  const leagues = await listLeaguesForUser(userId);
  const league = leagues.find((item) => item.id === focusedId) ?? leagues[0];
  if (!league) throw httpError("Entra in una lega: nome e colori stanno sulla squadra di quella lega.", 409);
  const team = await ensureLeagueTeam(userId, league.id, name);
  const renamed = await admin.from("fantasy_teams").update({ name }).eq("id", team.id).eq("user_id", userId);
  if (renamed.error) throw new Error(renamed.error.message);

  let logoUrl = "";
  const current = await readTeamLook(team.id, name);
  logoUrl = current.logoUrl;
  if (input.logo) {
    const extension = input.logo.mime === "image/png" ? "png" : "jpg";
    const path = `teams/${team.id}/${crypto.randomUUID()}.${extension}`;
    const uploaded = await admin.storage.from("brand-assets").upload(path, input.logo.bytes, { contentType: input.logo.mime, upsert: false });
    if (uploaded.error) {
      if (/bucket|not found|brand-assets/i.test(uploaded.error.message)) {
        throw httpError("Manca il bucket dei file. Esegui supabase/brand_storage.sql nell'editor SQL.", 503);
      }
      throw new Error(uploaded.error.message);
    }
    logoUrl = admin.storage.from("brand-assets").getPublicUrl(path).data.publicUrl;
  }

  const saved = await admin.from("app_settings").upsert({
    key: keyOf(team.id),
    value: { primary, secondary, logoUrl },
    updated_at: new Date().toISOString(),
  });
  if (saved.error) {
    if (/app_settings|schema cache|could not find|does not exist/i.test(saved.error.message)) {
      throw httpError("Manca app_settings. I colori e il logo non sono stati salvati.", 503);
    }
    throw new Error(saved.error.message);
  }
  return { teamId: team.id, name, primary, secondary, logoUrl };
}
