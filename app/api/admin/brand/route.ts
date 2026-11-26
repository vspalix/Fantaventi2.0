import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { apiError } from "@/lib/server/api-error";
import { resetBrand, saveBrandAccent, saveBrandSlot } from "@/lib/server/brand";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { createAdminSupabase } from "@/lib/supabase/admin";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function slotOf(value: FormDataEntryValue | null) {
  return value === "logo" || value === "icon192" || value === "icon512" ? value : null;
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await request.json() as { reset?: boolean; accentColor?: string };
      if (body.reset === true) return NextResponse.json({ brand: await resetBrand() });
      if (typeof body.accentColor === "string") return NextResponse.json({ brand: await saveBrandAccent(body.accentColor) });
      return NextResponse.json({ error: "Niente da salvare." }, { status: 400 });
    }

    const form = await request.formData();
    const slot = slotOf(form.get("slot"));
    const file = form.get("file");
    if (!slot || !(file instanceof File)) return NextResponse.json({ error: "Scegli un file e il tipo di immagine." }, { status: 400 });
    const extension = TYPES[file.type];
    if (!extension) return NextResponse.json({ error: "Formato ammesso: PNG, SVG o WebP." }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "L'immagine deve stare entro 2 MB." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (extension === "svg" && /<script|onload=|javascript:/i.test(bytes.toString("utf8"))) {
      return NextResponse.json({ error: "Questo SVG non è accettato." }, { status: 400 });
    }

    const path = `${slot}/${randomUUID()}.${extension}`;
    const admin = createAdminSupabase();
    const uploaded = await admin.storage.from("brand-assets").upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploaded.error) {
      const message = uploaded.error.message;
      if (/bucket|not found|brand-assets/i.test(message)) {
        return NextResponse.json({ error: "Manca il bucket. Esegui supabase/brand_storage.sql nell'editor SQL." }, { status: 503 });
      }
      throw new Error(message);
    }
    const url = admin.storage.from("brand-assets").getPublicUrl(path).data.publicUrl;
    return NextResponse.json({ brand: await saveBrandSlot(slot, url) });
  } catch (error) {
    return apiError("API /api/admin/brand (POST)", error);
  }
}
