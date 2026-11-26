import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { assertServiceEnv } from "@/lib/server/catalog";
import { readMaintenance, setMaintenance } from "@/lib/server/maintenance";
import { requireSuperAdmin } from "@/lib/server/platform-role";

export async function GET() {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    return NextResponse.json(await readMaintenance());
  } catch (error) {
    return apiError("API /api/admin/maintenance (GET)", error);
  }
}

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const body = (await request.json()) as { enabled?: boolean; message?: string };
    const state = await setMaintenance(body.enabled === true, body.message);
    return NextResponse.json(state);
  } catch (error) {
    return apiError("API /api/admin/maintenance (POST)", error);
  }
}
