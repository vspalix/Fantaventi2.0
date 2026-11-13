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
    <header className="site-header">
      <div className="shell">
        <Link href="/" className="brand">
          <strong>FANTAVENTI</strong>
          <span>Rosa libera, prima della deadline</span>
        </Link>
        <nav className="nav">
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
              <Link href="/account">Account</Link>
              <button className="text-button" type="button" onClick={signOut}>
                Esci
              </button>
            </>
          ) : pathname.startsWith("/accesso") ? null : (
            <Link className="primary" href="/accesso">Accedi</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
