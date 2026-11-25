import { NextResponse } from "next/server";
import { readSponsors, saveSponsorStrip, uploadSponsorImage, type SponsorItem } from "@/lib/server/sponsors";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";

const MAX_BYTES = 2 * 1024 * 1024;

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json({ sponsors: await readSponsors() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await request.json() as { scrollSeconds?: unknown; items?: SponsorItem[] };
      const sponsors = await saveSponsorStrip({
        scrollSeconds: Number(body.scrollSeconds),
        items: Array.isArray(body.items) ? body.items : [],
      });
      return NextResponse.json({ sponsors });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Scegli un'immagine." }, { status: 400 });
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      return NextResponse.json({ error: "Per il controllo del contenuto carica un PNG o un JPEG." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "L'immagine deve stare entro 2 MB." }, { status: 400 });
    const imageUrl = await uploadSponsorImage(Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json({ imageUrl });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
