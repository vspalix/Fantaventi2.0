import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { bundledSerieACalendar, importSerieACalendar, parseCalendarPayload } from "@/lib/server/serie-a-calendar";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSuperAdmin();
    const body = await request.json().catch(() => ({})) as { rounds?: unknown };
    const bundled = !body.rounds;
    const rounds = bundled ? bundledSerieACalendar() : parseCalendarPayload(body);
    const result = await importSerieACalendar(user.id, rounds, bundled ? "bundled" : "payload");
    return NextResponse.json(result);
  } catch (error) {
    return apiError("API /api/admin/import-calendar (POST)", error);
  }
}
