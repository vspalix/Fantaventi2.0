import { Suspense, type ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { ToastHost } from "@/components/ToastHost";
import { SiteHeader, type HeaderSeason, type HeaderSquad } from "@/components/SiteHeader";
import { AnnounceModal } from "@/components/AnnounceModal";
import { NativeBridge } from "@/components/NativeBridge";
import { ClubBadgeProvider } from "@/components/TeamBadge";
import { accentOrDefault } from "@/lib/brand";
import { readBrand } from "@/lib/server/brand";
import { loadActiveAnnouncements } from "@/lib/server/announcements";
import { loadClubBadgeOverrides } from "@/lib/server/club-badges";
import { INVITE_COOKIE, joinHref, normalizeInviteCode } from "@/lib/invite";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { mustResetPassword } from "@/lib/server/account-password";
import { readMaintenance } from "@/lib/server/maintenance";
import { getCurrentSeason, listPlayableSeasons } from "@/lib/server/catalog";
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

export const metadata: Metadata = {
  title: "Fantaventi",
  description: "Fantacalcio gratuito con rose da un calciatore per club.",
  applicationName: "FantaVenti",
  appleWebApp: {
    capable: true,
    title: "FantaVenti",
    statusBarStyle: "black-translucent",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
  interactiveWidget: "resizes-content",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const service = hasServiceSupabaseEnv();
  const user = hasPublicSupabaseEnv() ? await getSessionUser() : null;
  const [access, path, needsReset, maintenance, playable, badges, announcements, brand, jar] = await Promise.all([
    user && service
      ? hostAccess(user.id)
      : Promise.resolve({ platformAdmin: false, canSwitch: false, hostMode: false }),
    headers().then((value) => value.get("x-pathname") ?? ""),
    user && service ? mustResetPassword(user.id).catch(() => false) : Promise.resolve(false),
    service
      ? readMaintenance().catch(() => ({ enabled: false, message: "", updatedAt: null }))
      : Promise.resolve({ enabled: false, message: "", updatedAt: null as string | null }),
    service ? listPlayableSeasons(createAdminSupabase()).catch(() => []) : Promise.resolve([]),
    loadClubBadgeOverrides(),
    user ? loadActiveAnnouncements() : Promise.resolve([]),
    readBrand(),
    cookies(),
  ]);
  const { platformAdmin, canSwitch, hostMode } = access;
  if (user && service && needsReset && !path.startsWith("/accesso/nuova-password")) {
    const code = normalizeInviteCode(jar.get(INVITE_COOKIE)?.value);
    redirect(code ? `/accesso/nuova-password?next=${encodeURIComponent(joinHref(code))}` : "/accesso/nuova-password");
  }
  let seasons: HeaderSeason[] = playable.map((season) => ({
    id: season.id,
    label: `${season.competitionName} ${season.code}`,
  }));
  let activeSeasonId: string | null = null;
  let squads: HeaderSquad[] = [];
  let activeLeagueId: string | null = null;
  let profileLabel = user?.email?.split("@")[0] ?? "";
  if (service && playable.length > 0) {
    try {
      const admin = createAdminSupabase();
      const season = await getCurrentSeason(admin);
      activeSeasonId = season.id;
      if (user && activeSeasonId) {
        const [leagues, profile] = await Promise.all([
          listLeaguesForUser(user.id),
          admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
        ]);
        squads = leagues.map((league) => ({
          id: league.id,
          teamName: league.teamName || "La tua squadra",
          leagueName: league.name,
        }));
        const saved = jar.get(LEAGUE_FOCUS_COOKIE)?.value;
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
  const accent = accentOrDefault(brand.accentColor);
  const red = Number.parseInt(accent.slice(1, 3), 16);
  const green = Number.parseInt(accent.slice(3, 5), 16);
  const blue = Number.parseInt(accent.slice(5, 7), 16);
  return (
    <html lang="it">
      <body className={`${sans.variable} ${mono.variable}`} style={{ ["--accent" as string]: accent, ["--glow" as string]: `0 0 28px rgba(${red}, ${green}, ${blue}, 0.16)` }}>
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
        {announcements.length > 0 ? <AnnounceModal items={announcements} /> : null}
        <NativeBridge />
        <ToastHost />
        </ClubBadgeProvider>
      </body>
    </html>
  );
}
