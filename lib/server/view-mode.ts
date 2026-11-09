import { cookies } from "next/headers";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { isSuperAdmin } from "@/lib/server/platform-role";

export const VIEW_COOKIE = "fv-view";

export async function readViewMode(): Promise<"player" | "host"> {
  try {
    const jar = await cookies();
    return jar.get(VIEW_COOKIE)?.value === "host" ? "host" : "player";
  } catch {
    return "player";
  }
}

export async function hostAccess(userId: string | null) {
  if (!userId) return { platformAdmin: false, canSwitch: false, hostMode: false };
  const platformAdmin = await isSuperAdmin(userId).catch(() => false);
  const leagueAdmin = platformAdmin
    ? false
    : await listLeaguesForUser(userId).then((leagues) => leagues.some((league) => league.isManager)).catch(() => false);
  const canSwitch = platformAdmin || leagueAdmin;
  const hostMode = canSwitch && await readViewMode() === "host";
  return { platformAdmin, canSwitch, hostMode };
}
