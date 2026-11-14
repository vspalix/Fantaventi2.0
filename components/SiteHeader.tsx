"use client";

import Link from "next/link";
import { ModeSwitch } from "@/components/ModeSwitch";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserSupabase, hasPublicSupabaseEnv } from "@/lib/supabase/browser";

const LINKS = [
  { href: "/leghe", label: "Leghe" },
  { href: "/rosa", label: "Rosa" },
  { href: "/rules", label: "Regolamento" },
];

const TABS = [
  { href: "/", label: "Home", match: (pathname: string) => pathname === "/" },
  { href: "/leghe", label: "Leghe", match: (pathname: string) => pathname.startsWith("/leghe") },
  { href: "/rosa", label: "Rosa", match: (pathname: string) => pathname.startsWith("/rosa") },
  { href: "/rules", label: "Regole", match: (pathname: string) => pathname.startsWith("/rules") },
  { href: "/account", label: "Account", match: (pathname: string) => pathname.startsWith("/account") },
];

export type HeaderSeason = { id: string; label: string };

export function SiteHeader({
  email,
  seasons,
  activeSeasonId,
  platformAdmin,
  hostMode,
  canSwitch,
}: {
  email: string | null;
  seasons: HeaderSeason[];
  activeSeasonId: string | null;
  platformAdmin: boolean;
  hostMode: boolean;
  canSwitch: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function chooseSeason(seasonId: string) {
    if (seasonId === activeSeasonId) return;
    const response = await fetch("/api/season", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seasonId }),
    });
    if (response.ok) router.refresh();
  }

  async function signOut() {
    if (!hasPublicSupabaseEnv()) return;
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <header className="site-header">
        <div className="shell">
          <Link href="/" className="brand">
            <strong>FANTAVENTI</strong>
            <span>Rosa libera, prima della deadline</span>
          </Link>
          <nav className="nav" aria-label="Principale">
            {email ? (
              <>
                {seasons.length > 0 ? (
                  <select
                    className="season-switch"
                    aria-label="Competizione e stagione"
                    value={activeSeasonId ?? seasons[0].id}
                    onChange={(event) => void chooseSeason(event.target.value)}
                  >
                    {seasons.map((season) => (
                      <option key={season.id} value={season.id}>{season.label}</option>
                    ))}
                  </select>
                ) : null}
                <div className="nav-links">
                  {LINKS.map((link) => (
                    <Link key={link.href} href={link.href} data-active={pathname.startsWith(link.href)}>
                      {link.label}
                    </Link>
                  ))}
                  {canSwitch ? <ModeSwitch mode={hostMode ? "host" : "player"} /> : null}
                  {hostMode && platformAdmin ? (
                    <Link href="/admin" data-active={pathname.startsWith("/admin")}>
                      Laboratorio
                    </Link>
                  ) : null}
                  <Link href="/account" data-active={pathname.startsWith("/account")}>Account</Link>
                  <button className="text-button" type="button" onClick={signOut}>
                    Esci
                  </button>
                </div>
                <div className="nav-tools">
                  {canSwitch ? <ModeSwitch mode={hostMode ? "host" : "player"} /> : null}
                  {hostMode && platformAdmin ? (
                    <Link href="/admin" data-active={pathname.startsWith("/admin")}>
                      Laboratorio
                    </Link>
                  ) : null}
                  <button className="text-button" type="button" onClick={signOut}>
                    Esci
                  </button>
                </div>
              </>
            ) : pathname.startsWith("/accesso") ? null : (
              <Link className="primary" href="/accesso">Accedi</Link>
            )}
          </nav>
        </div>
      </header>
      {email ? (
        <nav className="tabbar" aria-label="Sezioni">
          {TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} data-active={tab.match(pathname)} aria-label={tab.label === "Regole" ? "Regolamento" : undefined}>
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </>
  );
}
