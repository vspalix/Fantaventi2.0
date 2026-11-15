"use client";

import Link from "next/link";
import { ModeSwitch } from "@/components/ModeSwitch";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase, hasPublicSupabaseEnv } from "@/lib/supabase/browser";

export type HeaderSeason = { id: string; label: string };
export type HeaderSquad = { id: string; teamName: string; leagueName: string };

export function SiteHeader({
  email,
  profileLabel,
  seasons,
  activeSeasonId,
  squads,
  activeLeagueId,
  platformAdmin,
  hostMode,
  canSwitch,
}: {
  email: string | null;
  profileLabel: string;
  seasons: HeaderSeason[];
  activeSeasonId: string | null;
  squads: HeaderSquad[];
  activeLeagueId: string | null;
  platformAdmin: boolean;
  hostMode: boolean;
  canSwitch: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const leagueTab = search.get("tab");
  const [open, setOpen] = useState<"squad" | "menu" | "profile" | null>(null);
  const bar = useRef<HTMLElement>(null);
  const pathLeague = pathname.match(/^\/leghe\/([^/]+)/)?.[1];
  const current = squads.find((squad) => squad.id === pathLeague)
    ?? squads.find((squad) => squad.id === activeLeagueId)
    ?? squads[0]
    ?? null;
  const leagueHref = (tab: string) => current ? `/leghe/${current.id}?tab=${tab}` : "/leghe";

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!bar.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  async function chooseSeason(seasonId: string) {
    if (seasonId === activeSeasonId) return;
    const response = await fetch("/api/season", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seasonId }),
    });
    if (response.ok) router.refresh();
  }

  async function chooseSquad(leagueId: string) {
    setOpen(null);
    await fetch("/api/active-league", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId }),
    });
    router.push(`/leghe/${leagueId}`);
    router.refresh();
  }

  async function signOut() {
    if (!hasPublicSupabaseEnv()) return;
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const initial = (profileLabel.trim()[0] ?? email?.[0] ?? "F").toUpperCase();

  return (
    <header className="site-header" ref={bar}>
      <div className="shell dash-shell">
        {email ? (
          <div className="dash-menu-wrap header-menu">
            <button className="menu-pill" type="button" aria-label="Menu" aria-expanded={open === "menu"} onClick={() => setOpen(open === "menu" ? null : "menu")}>
              <MenuIcon />
            </button>
            {open === "menu" ? (
              <ul className="dash-menu">
                <li><Link href="/leghe" onClick={() => setOpen(null)}>Leghe</Link></li>
                <li><Link href="/albo" onClick={() => setOpen(null)}>Albo</Link></li>
                <li><Link href="/rules" onClick={() => setOpen(null)}>Regolamento</Link></li>
                {seasons.length > 1 ? (
                  <li>
                    <label>
                      Stagione
                      <select aria-label="Competizione e stagione" value={activeSeasonId ?? seasons[0].id} onChange={(event) => void chooseSeason(event.target.value)}>
                        {seasons.map((season) => <option key={season.id} value={season.id}>{season.label}</option>)}
                      </select>
                    </label>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : <span className="header-menu" />}

        {email && current ? (
          <div className="squad-switch">
            <button className="squad-pill" type="button" aria-expanded={open === "squad"} aria-haspopup="listbox" onClick={() => setOpen(open === "squad" ? null : "squad")}>
              <span className="squad-mark" aria-hidden="true">
                <ShieldIcon />
              </span>
              <span className="squad-copy">
                <strong>{current.teamName}</strong>
                <small>{current.leagueName}</small>
              </span>
              <ChevronIcon />
            </button>
            {open === "squad" ? (
              <ul className="dash-menu" role="listbox" aria-label="Le tue squadre">
                {squads.map((squad) => (
                  <li key={squad.id}>
                    <button type="button" data-active={squad.id === current.id} onClick={() => void chooseSquad(squad.id)}>
                      <strong>{squad.teamName}</strong>
                      <small>{squad.leagueName}</small>
                    </button>
                  </li>
                ))}
                <li><Link href="/leghe" onClick={() => setOpen(null)}>Tutte le leghe</Link></li>
              </ul>
            ) : null}
          </div>
        ) : (
          <Link href={email ? "/rosa" : "/"} className="squad-pill squad-link">
            <span className="squad-mark" aria-hidden="true"><ShieldIcon /></span>
            <span className="squad-copy">
              <strong>{email ? "Crea la rosa" : "Fantaventi"}</strong>
              <small>{email ? "Nessuna squadra ancora" : "Rosa libera"}</small>
            </span>
          </Link>
        )}

        {email ? (
          <nav className="dash-tabs" aria-label="Sezioni">
            <Link href="/" data-active={pathname === "/"}><HomeIcon />Dashboard</Link>
            <Link href="/rosa" data-active={pathname.startsWith("/rosa")}><ShieldIcon />Rosa</Link>
            <Link href={leagueHref("risultati")} data-active={Boolean(current && pathname.startsWith(`/leghe/${current.id}`) && leagueTab === "risultati")}><CalendarIcon />Calendario</Link>
            <Link href={leagueHref("classifica")} data-active={Boolean(current && pathname.startsWith(`/leghe/${current.id}`) && leagueTab === "classifica")}><TrophyIcon />Classifica</Link>
          </nav>
        ) : <span className="tabs-slot" />}

        {email ? (
          <div className="profile-switch">
            <button className="profile-pill" type="button" aria-label="Profilo" aria-expanded={open === "profile"} onClick={() => setOpen(open === "profile" ? null : "profile")}>
              <span>{initial}</span>
            </button>
            {open === "profile" ? (
              <ul className="dash-menu dash-menu-right">
                <li className="profile-name">{profileLabel}</li>
                {canSwitch ? <li className="profile-mode"><ModeSwitch mode={hostMode ? "host" : "player"} /></li> : null}
                {hostMode && platformAdmin ? <li><Link href="/admin" onClick={() => setOpen(null)}>Admin</Link></li> : null}
                <li><Link href="/account" onClick={() => setOpen(null)}>Account</Link></li>
                <li><button type="button" onClick={() => void signOut()}>Esci</button></li>
              </ul>
            ) : null}
          </div>
        ) : pathname.startsWith("/accesso") ? <span /> : (
          <Link className="primary dash-login" href="/accesso">Accedi</Link>
        )}
      </div>
    </header>
  );
}

function ChevronIcon() {
  return (
    <svg className="squad-chevron" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19 6.2v5.4c0 4.2-2.8 7.2-7 8.9-4.2-1.7-7-4.7-7-8.9V6.2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3.5v3M16 3.5v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8v6a4 4 0 0 1-8 0zM6 6H4.5A2.5 2.5 0 0 0 7 10.2M18 6h1.5A2.5 2.5 0 0 1 17 10.2M12 14v3M9 20h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
