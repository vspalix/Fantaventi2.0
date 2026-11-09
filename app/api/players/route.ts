import { NextResponse } from "next/server";
import { assertServiceEnv, loadCatalog } from "@/lib/server/catalog";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";

export async function GET(request: Request) {
  try {
    assertServiceEnv();
    await requireSessionUser();
    const catalog = await loadCatalog();
    const { searchParams } = new URL(request.url);
    const role = searchParams.get("role");
    const query = searchParams.get("q")?.trim().toLocaleLowerCase("it") ?? "";

    const players = catalog.players.filter((player) => {
      const roleOk = !role || role === "ALL" || player.role === role;
      const text = `${player.fullName} ${player.clubName}`.toLocaleLowerCase("it");
      return roleOk && (!query || text.includes(query));
    });

    return NextResponse.json({ ...catalog, players });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
