import { cookies } from "next/headers";
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
  const canSwitch = platformAdmin;
  const hostMode = platformAdmin && await readViewMode() === "host";
  return { platformAdmin, canSwitch, hostMode };
}
