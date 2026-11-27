import { Suspense, type ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { ToastHost } from "@/components/ToastHost";
import { SiteHeader, type HeaderSeason, type HeaderSquad } from "@/components/SiteHeader";
import { MyLeaguesProvider } from "@/components/leagues/MyLeagues";
import { HomeCacheProvider, SwitchStage } from "@/components/home/HomeCache";
import { AnnounceModal } from "@/components/AnnounceModal";
import { NativeBridge } from "@/components/NativeBridge";
import { ClubBadgeProvider } from "@/components/TeamBadge";
import { unseenAnnouncements } from "@/lib/announcements";
import { accentInk, accentOrDefault } from "@/lib/brand";
import { readBrand } from "@/lib/server/brand";
import { loadActiveAnnouncements } from "@/lib/server/announcements";
import { loadClubBadgeOverrides } from "@/lib/server/club-badges";
import { INVITE_COOKIE, joinHref, normalizeInviteCode } from "@/lib/invite";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { listLeaguesForUser } from "@/lib/server/leagues";
import { mustResetPassword } from "@/lib/server/account-password";
import { readMaintenanceBanner } from "@/lib/server/maintenance";
import { getCurrentSeason, listPlayableSeasons } from "@/lib/server/catalog";
import { reportError } from "@/lib/server/error-report";
import { getSessionUser, SESSION_UNAVAILABLE, sessionUnavailable } from "@/lib/server/session";
import { hostAccess } from "@/lib/server/view-mode";
import { createAdminSupabase, hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";
import type { LeagueSummary } from "@/lib/types";
import "./globals.css";

const sans = Jost({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
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
  themeColor: "#0f0e0c",
  interactiveWidget: "resizes-content",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const service = hasServiceSupabaseEnv();
  const user = hasPublicSupabaseEnv() ? await getSessionUser() : null;
  const authDown = await sessionUnavailable();
  // La parte comune non deve mai bloccare la pagina: se una lettura utile manca, lo si dice.
  let incomplete = false;
  const orElse = <T,>(where: string, read: Promise<T>, fallback: T) => read.catch((error: unknown) => {
    incomplete = true;
    void reportError(where, error);
    return fallback;
  });
  const [access, path, needsReset, maintenance, playable, badges, announcements, brand, jar] = await Promise.all([
    user && service
      ? hostAccess(user.id)
      : Promise.resolve({ platformAdmin: false, canSwitch: false, hostMode: false }),
    headers().then((value) => value.get("x-pathname") ?? ""),
    user && service ? orElse("Parte comune: cambio password obbligatorio", mustResetPassword(user.id), false) : Promise.resolve(false),
    service
      ? readMaintenanceBanner().catch((error: unknown) => {
        void reportError("Parte comune: avviso di manutenzione", error);
        return { enabled: false, message: "", updatedAt: null };
      })
      : Promise.resolve({ enabled: false, message: "", updatedAt: null as string | null }),
    service ? orElse("Parte comune: stagioni", listPlayableSeasons(createAdminSupabase()), []) : Promise.resolve([]),
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
  let myLeagues: LeagueSummary[] | null = null;
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
        // Il codice invito arriva al telefono solo per le leghe che si amministrano.
        myLeagues = leagues.map((league) => (league.isManager ? league : { ...league, joinCode: "" }));
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
    } catch (error) {
      incomplete = true;
      void reportError("Parte comune: squadre e profilo", error);
      seasons = [];
      activeSeasonId = null;
      squads = [];
      myLeagues = null;
      activeLeagueId = null;
    }
  }
  const accent = accentOrDefault(brand.accentColor);
  const red = Number.parseInt(accent.slice(1, 3), 16);
  const green = Number.parseInt(accent.slice(3, 5), 16);
  const blue = Number.parseInt(accent.slice(5, 7), 16);
  return (
    <html lang="it">
      <body className={sans.variable} style={{ ["--accent" as string]: accent, ["--accent-ink" as string]: accentInk(accent), ["--glow" as string]: `0 0 28px rgba(${red}, ${green}, ${blue}, 0.16)` }}>
        <ClubBadgeProvider badges={badges}>
        <MyLeaguesProvider leagues={myLeagues}>
        <HomeCacheProvider owner={user?.id ?? null}>
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
        <main className="shell page">
          {authDown || incomplete ? (
            <p className="banner" role="status">
              {authDown ? SESSION_UNAVAILABLE : "Qualche informazione non si è caricata. Ricarica la pagina tra poco."}
            </p>
          ) : null}
          <SwitchStage>{children}</SwitchStage>
        </main>
        {user ? <AnnounceModal key={user.id} items={unseenAnnouncements(announcements, user.app_metadata)} /> : null}
        <NativeBridge />
        <ToastHost />
        </HomeCacheProvider>
        </MyLeaguesProvider>
        </ClubBadgeProvider>
      </body>
    </html>
  );
}
