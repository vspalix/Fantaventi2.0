import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { readSyncLogs, readSystemSettings, saveSystemSettings } from "@/lib/server/system-settings";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const [settings, logs] = await Promise.all([readSystemSettings(), readSyncLogs(20)]);
    return NextResponse.json({ settings, logs });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = await request.json() as {
      votesSourceUrl?: string;
      votesProvider?: string;
      apiSportsLeagueId?: number;
      apiSportsSeason?: number;
      syncWindowPostMatchMin?: number;
      syncWindowPostMatchMax?: number;
      syncWindowEveningStart?: string;
      syncWindowEveningEnd?: string;
      syncWindowMorningStart?: string;
      syncWindowMorningEnd?: string;
      autoSyncEnabled?: boolean;
      notifyOnSyncSuccess?: boolean;
    };
    const current = await readSystemSettings();
    const settings = await saveSystemSettings({
      votesSourceUrl: body.votesSourceUrl ?? current.votesSourceUrl,
      votesProvider: body.votesProvider ?? current.votesProvider,
      availabilityProvider: "api-sports",
      apiSportsLeagueId: body.apiSportsLeagueId ?? current.apiSportsLeagueId,
      apiSportsSeason: body.apiSportsSeason ?? current.apiSportsSeason,
      syncWindowPostMatchMin: body.syncWindowPostMatchMin ?? current.syncWindowPostMatchMin,
      syncWindowPostMatchMax: body.syncWindowPostMatchMax ?? current.syncWindowPostMatchMax,
      syncWindowEveningStart: body.syncWindowEveningStart ?? current.syncWindowEveningStart,
      syncWindowEveningEnd: body.syncWindowEveningEnd ?? current.syncWindowEveningEnd,
      syncWindowMorningStart: body.syncWindowMorningStart ?? current.syncWindowMorningStart,
      syncWindowMorningEnd: body.syncWindowMorningEnd ?? current.syncWindowMorningEnd,
      autoSyncEnabled: body.autoSyncEnabled ?? current.autoSyncEnabled,
      notifyOnSyncSuccess: body.notifyOnSyncSuccess ?? current.notifyOnSyncSuccess,
    });
    return NextResponse.json({ settings: settings.settings, notice: settings.notice });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
