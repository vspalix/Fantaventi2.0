import { NextResponse } from "next/server";
import { listAnnouncements, saveAnnouncement, setAnnouncementActive } from "@/lib/server/announcements";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json({ announcements: await listAnnouncements() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = await request.json() as { id?: string; isActive?: boolean; toggle?: boolean };
    if (body.toggle && body.id) {
      await setAnnouncementActive(body.id, body.isActive === true);
      return NextResponse.json({ ok: true });
    }
    await saveAnnouncement(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
