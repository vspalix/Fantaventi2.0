import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { SiteHeader, type HeaderSeason } from "@/components/SiteHeader";
import { mustResetPassword } from "@/lib/server/account-password";
import { readMaintenance } from "@/lib/server/maintenance";
import { getCurrentSeason, listPlayableSeasons } from "@/lib/server/catalog";
import { getSessionUser } from "@/lib/server/session";
import { hostAccess } from "@/lib/server/view-mode";
import { createAdminSupabase, hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import "./globals.css";

export const metadata = {
  title: "Fantaventi",
  description: "Fantacalcio gratuito con rose da un calciatore per club.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = hasPublicSupabaseEnv() ? await getSessionUser() : null;
  const access = user && hasServiceSupabaseEnv()
    ? await hostAccess(user.id)
    : { platformAdmin: false, canSwitch: false, hostMode: false };
  const { platformAdmin, canSwitch, hostMode } = access;
  const path = (await headers()).get("x-pathname") ?? "";
  if (user && hasServiceSupabaseEnv() && !path.startsWith("/accesso/nuova-password")) {
    if (await mustResetPassword(user.id).catch(() => false)) redirect("/accesso/nuova-password");
  }
  const maintenance = hasServiceSupabaseEnv()
    ? await readMaintenance().catch(() => ({ enabled: false, message: "", updatedAt: null }))
    : { enabled: false, message: "", updatedAt: null };
  let seasons: HeaderSeason[] = [];
  let activeSeasonId: string | null = null;
  if (hasServiceSupabaseEnv()) {
    try {
      const admin = createAdminSupabase();
      const playable = await listPlayableSeasons(admin);
      seasons = playable.map((season) => ({
        id: season.id,
        label: `${season.competitionName} ${season.code}`,
      }));
      if (playable.length > 0) activeSeasonId = (await getCurrentSeason(admin)).id;
    } catch {
      seasons = [];
      activeSeasonId = null;
    }
  }
  return (
    <html lang="it">
      <body>
        <SiteHeader
          email={user?.email ?? null}
          seasons={seasons}
          activeSeasonId={activeSeasonId}
          platformAdmin={platformAdmin}
          hostMode={hostMode}
          canSwitch={canSwitch}
        />
        {maintenance.enabled ? <MaintenanceBanner message={maintenance.message} admin={platformAdmin} /> : null}
        <main className="shell page">{children}</main>
      </body>
    </html>
  );
}
