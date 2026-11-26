import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { deleteNews, listAllNews, saveNews } from "@/lib/server/news";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json({ news: await listAllNews() });
  } catch (error) {
    return apiError("API /api/admin/news (GET)", error);
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
    return apiError("API /api/admin/news (POST)", error);
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
    return apiError("API /api/admin/news (DELETE)", error);
  }
}
