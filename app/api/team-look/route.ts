import { NextResponse } from "next/server";
import { saveTeamLook } from "@/lib/server/team-look";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await request.json() as { name?: unknown; primary?: unknown; secondary?: unknown };
      const look = await saveTeamLook(user.id, {
        name: typeof body.name === "string" ? body.name : "",
        primary: typeof body.primary === "string" ? body.primary : "",
        secondary: typeof body.secondary === "string" ? body.secondary : "",
      });
      return NextResponse.json({ look });
    }
    const form = await request.formData();
    const file = form.get("file");
    let logo: { bytes: Buffer; mime: string } | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.type !== "image/png" && file.type !== "image/jpeg") {
        return NextResponse.json({ error: "Per il controllo del contenuto carica un PNG o un JPEG." }, { status: 400 });
      }
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "L'immagine deve stare entro 2 MB." }, { status: 400 });
      logo = { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type };
    }
    const look = await saveTeamLook(user.id, {
      name: String(form.get("name") ?? ""),
      primary: String(form.get("primary") ?? ""),
      secondary: String(form.get("secondary") ?? ""),
      logo,
    });
    return NextResponse.json({ look });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
