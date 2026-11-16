import { Suspense, type ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { ToastHost } from "@/components/ToastHost";
import { SiteHeader, type HeaderSeason, type HeaderSquad } from "@/components/SiteHeader";
import { ClubBadgeProvider } from "@/components/TeamBadge";
import { loadClubBadgeOverrides } from "@/lib/server/club-badges";
import { INVITE_COOKIE, joinHref, normalizeInviteCode } from "@/lib/invite";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { mustResetPassword } from "@/lib/server/account-password";
import { readMaintenance } from "@/lib/server/maintenance";
import { getCurrentSeason, getFantasyTeam, listPlayableSeasons } from "@/lib/server/catalog";
import { getSessionUser } from "@/lib/server/session";
import { hostAccess } from "@/lib/server/view-mode";
import { createAdminSupabase, hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-mono",
});

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
    if (await mustResetPassword(user.id).catch(() => false)) {
      const code = normalizeInviteCode((await cookies()).get(INVITE_COOKIE)?.value);
      redirect(code ? `/accesso/nuova-password?next=${encodeURIComponent(joinHref(code))}` : "/accesso/nuova-password");
    }
  }
  const maintenance = hasServiceSupabaseEnv()
    ? await readMaintenance().catch(() => ({ enabled: false, message: "", updatedAt: null }))
    : { enabled: false, message: "", updatedAt: null };
  let seasons: HeaderSeason[] = [];
  let activeSeasonId: string | null = null;
  let squads: HeaderSquad[] = [];
  let activeLeagueId: string | null = null;
  let profileLabel = user?.email?.split("@")[0] ?? "";
  if (hasServiceSupabaseEnv()) {
    try {
      const admin = createAdminSupabase();
      const playable = await listPlayableSeasons(admin);
      seasons = playable.map((season) => ({
        id: season.id,
        label: `${season.competitionName} ${season.code}`,
      }));
      if (playable.length > 0) activeSeasonId = (await getCurrentSeason(admin)).id;
      if (user && activeSeasonId) {
        const [team, leagues, profile] = await Promise.all([
          getFantasyTeam(admin, user.id, activeSeasonId),
          listLeaguesForUser(user.id),
          admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
        ]);
        const teamName = team?.name ?? "La tua squadra";
        squads = leagues.map((league) => ({ id: league.id, teamName, leagueName: league.name }));
        const saved = (await cookies()).get(LEAGUE_FOCUS_COOKIE)?.value;
        activeLeagueId = squads.find((squad) => squad.id === saved)?.id ?? squads[0]?.id ?? null;
        const displayName = profile.data?.display_name;
        if (typeof displayName === "string" && displayName.trim()) profileLabel = displayName.trim();
      }
    } catch {
      seasons = [];
      activeSeasonId = null;
      squads = [];
      activeLeagueId = null;
    }
  }
  const badges = await loadClubBadgeOverrides();
  return (
    <html lang="it">
      <body className={`${sans.variable} ${mono.variable}`}>
        <ClubBadgeProvider badges={badges}>
        <Suspense fallback={<header className="site-header" />}>
          <SiteHeader
            email={user?.email ?? null}
            profileLabel={profileLabel}
            seasons={seasons}
            activeSeasonId={activeSeasonId}
            squads={squads}
            activeLeagueId={activeLeagueId}
            platformAdmin={platformAdmin}
            hostMode={hostMode}
            canSwitch={canSwitch}
          />
        </Suspense>
        {maintenance.enabled ? <MaintenanceBanner message={maintenance.message} admin={platformAdmin} /> : null}
        <main className="shell page">{children}</main>
        <ToastHost />
        </ClubBadgeProvider>
      </body>
    </html>
  );
}
