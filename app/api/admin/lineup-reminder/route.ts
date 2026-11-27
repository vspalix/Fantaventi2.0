import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { previewLineupReminder, saveReminderSettings } from "@/lib/server/lineup-reminder";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json(await previewLineupReminder());
  } catch (error) {
    return apiError("API /api/admin/lineup-reminder (GET)", error);
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = await request.json() as { enabled?: unknown; leadMinutes?: unknown };
    await saveReminderSettings({ enabled: body.enabled, leadMinutes: body.leadMinutes });
    return NextResponse.json(await previewLineupReminder());
  } catch (error) {
    return apiError("API /api/admin/lineup-reminder (POST)", error);
  }
}
