import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { deleteNews, listAllNews, saveNews } from "@/lib/server/news";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json({ news: await listAllNews() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = (await request.json()) as {
      id?: string;
      title?: string;
      body?: string;
      linkUrl?: string;
      linkLabel?: string;
      pinned?: boolean;
      published?: boolean;
    };
    return NextResponse.json({ news: await saveNews(body) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function DELETE(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = (await request.json()) as { id?: string };
    if (!body.id) return NextResponse.json({ error: "Manca la news." }, { status: 400 });
    await deleteNews(body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
