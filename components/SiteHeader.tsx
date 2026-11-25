"use client";

import Link from "next/link";
import { AppDrawer } from "@/components/AppDrawer";
import { InboxBell } from "@/components/InboxBell";
import { ModeSwitch } from "@/components/ModeSwitch";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase, hasPublicSupabaseEnv } from "@/lib/supabase/browser";
import { isHubTab, LEAGUE_TAB_EVENT, type HubTab } from "@/lib/hub-tabs";

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
  brandLogoUrl = "",
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
  brandLogoUrl?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [leagueTab, setLeagueTab] = useState(search.get("tab"));
  const [open, setOpen] = useState<"squad" | "menu" | "profile" | "more" | null>(null);
  const bar = useRef<HTMLElement>(null);
  const clientTab = useRef<string | null>(null);
  const pathLeague = pathname.match(/^\/leghe\/([^/]+)/)?.[1];
  const current = squads.find((squad) => squad.id === pathLeague)
    ?? squads.find((squad) => squad.id === activeLeagueId)
    ?? squads[0]
    ?? null;
  const leagueHref = (tab: string) => current ? `/leghe/${current.id}?tab=${tab}` : "/leghe";

  function openLeague(tab: HubTab, event?: { preventDefault: () => void }) {
    setOpen(null);
    if (!current || !pathname.startsWith(`/leghe/${current.id}`)) return;
    event?.preventDefault();
    window.history.replaceState(null, "", `/leghe/${current.id}?tab=${tab}`);
    window.dispatchEvent(new CustomEvent(LEAGUE_TAB_EVENT, { detail: tab }));
    clientTab.current = tab;
    setLeagueTab(tab);
  }

  useEffect(() => {
    if (clientTab.current) {
      clientTab.current = null;
      return;
    }
    setLeagueTab(search.get("tab"));
  }, [pathname, search]);

  useEffect(() => {
    setOpen(null);
  }, [pathname, leagueTab]);

  useEffect(() => {
    function onTab(event: Event) {
      const tab = (event as CustomEvent<string>).detail;
      if (isHubTab(tab)) setLeagueTab(tab);
    }
    function onPop() {
      const tab = new URLSearchParams(window.location.search).get("tab");
      setLeagueTab(tab);
    }
    window.addEventListener(LEAGUE_TAB_EVENT, onTab);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener(LEAGUE_TAB_EVENT, onTab);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    router.prefetch("/");
    router.prefetch("/rosa");
    router.prefetch("/calendario");
    router.prefetch("/leghe");
    if (!current) return;
    router.prefetch(`/leghe/${current.id}?tab=risultati`);
    router.prefetch(`/leghe/${current.id}?tab=classifica`);
    router.prefetch(`/leghe/${current.id}?tab=formazione`);
  }, [router, current?.id]);

  useEffect(() => {
    function close(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bar.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".tabbar, .drawer, .inbox, .more-sheet")) return;
      setOpen(null);
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
    if (pathname === "/") {
      router.refresh();
      return;
    }
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

  return (
    <>
    <header className="site-header" ref={bar}>
      <div className="shell dash-shell">
        {email ? (
          <div className="dash-menu-wrap header-menu">
            <button className="menu-pill" type="button" aria-label="Menu" aria-expanded={open === "menu"} onClick={() => setOpen(open === "menu" ? null : "menu")}>
              <MenuIcon />
            </button>
            {open === "menu" ? (
              <AppDrawer onClose={() => setOpen(null)}>
                <p className="drawer-kicker">Menu</p>
                <Link href={current ? `/leghe/${current.id}?tab=formazione` : "/rosa"} onClick={(event) => openLeague("formazione", event)}>Formazione</Link>
                <Link href={current ? `/leghe/${current.id}?tab=regolamento` : "/regolamento"} onClick={(event) => openLeague("regolamento", event)}>Regolamento</Link>
                <Link href={current ? `/leghe/${current.id}?tab=lega` : "/leghe"} onClick={(event) => openLeague("lega", event)}>Impostazioni lega</Link>
                <Link href="/leghe" onClick={() => setOpen(null)}>Leghe</Link>
                <Link href="/calendario" onClick={() => setOpen(null)}>Calendario Serie A</Link>
                <Link href="/albo" onClick={() => setOpen(null)}>Albo</Link>
                {hostMode && platformAdmin ? <Link href="/admin" onClick={() => setOpen(null)}>Pannello admin</Link> : null}
                {seasons.length > 1 ? (
                  <label>
                    Stagione
                    <select aria-label="Competizione e stagione" value={activeSeasonId ?? seasons[0].id} onChange={(event) => void chooseSeason(event.target.value)}>
                      {seasons.map((season) => <option key={season.id} value={season.id}>{season.label}</option>)}
                    </select>
                  </label>
                ) : null}
                <p className="drawer-kicker">Profilo</p>
                <p className="profile-name">{profileLabel}</p>
                {canSwitch ? <div className="profile-mode"><ModeSwitch mode={hostMode ? "host" : "player"} /></div> : null}
                <Link href="/account" onClick={() => setOpen(null)}>Account</Link>
                <button type="button" onClick={() => void signOut()}>Esci</button>
              </AppDrawer>
            ) : null}
          </div>
        ) : <span className="header-menu" />}

        {email && current ? (
          <div className="squad-switch">
            <button className="squad-pill" type="button" aria-expanded={open === "squad"} aria-haspopup="listbox" onClick={() => setOpen(open === "squad" ? null : "squad")}>
              <span className="squad-mark" aria-hidden="true">
                {brandLogoUrl ? <img src={brandLogoUrl} alt="" /> : <ShieldIcon />}
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
            <span className="squad-mark" aria-hidden="true">{brandLogoUrl ? <img src={brandLogoUrl} alt="" /> : <ShieldIcon />}</span>
            <span className="squad-copy">
              <strong>{email ? "Crea la rosa" : "Fantaventi"}</strong>
              <small>{email ? "Nessuna squadra ancora" : "Rosa libera"}</small>
            </span>
          </Link>
        )}

        {email ? <InboxBell /> : pathname.startsWith("/accesso") ? <span /> : (
          <Link className="primary dash-login" href="/accesso">Accedi</Link>
        )}
      </div>
    </header>
    {email ? (
      <nav className="tabbar" aria-label="Principale">
        <Link href="/" data-active={pathname === "/"}><HomeIcon />Dashboard</Link>
        <Link href="/rosa" data-active={pathname.startsWith("/rosa")}><ShieldIcon />Squadra</Link>
        <Link href={leagueHref("risultati")} data-active={Boolean(current && pathname.startsWith(`/leghe/${current.id}`) && leagueTab === "risultati")} onClick={(event) => openLeague("risultati", event)}><CalendarIcon />Calendario</Link>
        <Link href={leagueHref("classifica")} data-active={Boolean(current && pathname.startsWith(`/leghe/${current.id}`) && leagueTab === "classifica")} onClick={(event) => openLeague("classifica", event)}><TrophyIcon />Classifica</Link>
        <button type="button" data-active={open === "more"} onClick={() => setOpen(open === "more" ? null : "more")}><MoreIcon />Altro</button>
      </nav>
    ) : null}
    {email && open === "more" ? (
      <div className="more-sheet" role="menu" aria-label="Altro">
        <Link href={current ? `/leghe/${current.id}?tab=formazione` : "/rosa"} onClick={(event) => openLeague("formazione", event)}>Formazione</Link>
        <Link href={current ? `/leghe/${current.id}?tab=regolamento` : "/regolamento"} onClick={(event) => openLeague("regolamento", event)}>Regolamento</Link>
        {current ? <Link href={`/leghe/${current.id}?tab=lega`} onClick={(event) => openLeague("lega", event)}>Impostazioni lega</Link> : null}
        <Link href="/leghe" onClick={() => setOpen(null)}>Leghe</Link>
        <Link href="/calendario" onClick={() => setOpen(null)}>Calendario Serie A</Link>
        <Link href="/albo" onClick={() => setOpen(null)}>Albo</Link>
        <Link href="/account" onClick={() => setOpen(null)}>Account</Link>
      </div>
    ) : null}
  </>
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

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" />
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
