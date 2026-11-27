import { NextResponse } from "next/server";
import { markAnnouncementSeen } from "@/lib/server/announcements";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSessionUser } from "@/lib/server/session";

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const body = (await request.json()) as { id?: unknown };
    await markAnnouncementSeen(user, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError("API /api/announcements/seen (POST)", error);
  }
}
