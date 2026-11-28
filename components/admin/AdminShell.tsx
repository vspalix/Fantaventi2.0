"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ViewSwitch } from "@/components/ViewSwitch";
import { activeAdminTab, ADMIN_LEAGUE_COOKIE, ADMIN_TABS, LEAGUE_PAGES } from "@/lib/admin-area";

export type ShellLeague = { id: string; name: string; sandbox: boolean; teams: number; filed: number };

function missingOf(league: ShellLeague) {
  return Math.max(0, league.teams - league.filed);
}

/** Un disegno per ogni voce della barra, nell'ordine di ADMIN_TABS. */
const TAB_ICONS = [
  <path key="dashboard" d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z" />,
  <g key="giornata"><circle cx="12" cy="12" r="8.500" /><path d="M12 8.200 15.600 10.800 14.200 15H9.800L8.400 10.800zM12 3.500v4.700M20.100 9.400l-4.500 1.400M17 18.900 14.200 15M7 18.900 9.800 15M3.900 9.400l4.500 1.400" /></g>,
  <g key="utenti"><circle cx="9" cy="8.500" r="3.300" /><path d="M3.500 19.500c.4-3.400 2.6-5.2 5.5-5.2s5.1 1.800 5.500 5.2M15.500 5.600a3.100 3.100 0 0 1 0 5.8M17 14.600c2 .5 3.2 2.2 3.500 4.900" /></g>,
  <path key="notifiche" d="M6.500 10a5.500 5.500 0 0 1 11 0c0 5 2 6 2 6h-15s2-1 2-6M10 19.500a2.100 2.100 0 0 0 4 0" />,
  <path key="menu" d="M5 7h14M5 12h14M5 17h14" />,
];

export function AdminShell({ leagues, selectedId, children }: { leagues: ShellLeague[]; selectedId: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const withPicker = LEAGUE_PAGES.includes(pathname);
  const active = activeAdminTab(pathname);

  const selected = leagues.find((league) => league.id === selectedId) ?? null;
  const totalMissing = leagues.filter((league) => !league.sandbox).reduce((sum, league) => sum + missingOf(league), 0);

  useEffect(() => {
    setPickerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && pickerRef.current?.contains(event.target)) return;
      setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [pickerOpen]);

  function chooseLeague(id: string | null) {
    document.cookie = id
      ? `${ADMIN_LEAGUE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`
      : `${ADMIN_LEAGUE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    setPickerOpen(false);
    // Ricarica completa: con router.refresh() la pagina restava un passo indietro.
    window.location.reload();
  }

  return (
    <div className="sa-root">
      <header className="sa-top">
        <Link href="/admin" className="sa-brand">
          <span className="sa-brand-name">FantaVenti</span>
          <span className="sa-chip">Admin</span>
        </Link>
        <span className="sa-spacer" />
        {withPicker ? (
          <div className="sa-picker" ref={pickerRef}>
            <button
              type="button"
              className="sa-picker-btn"
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
              onClick={() => setPickerOpen((open) => !open)}
            >
              <span className="sa-picker-text">
                <span className="sa-picker-label">Lega</span>
                <span className="sa-picker-value">{selected?.name ?? "Tutte le leghe"}</span>
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {pickerOpen ? (
              <>
                <div className="sa-scrim" aria-hidden="true" />
                <div className="sa-picker-panel" role="dialog" aria-label="Scegli la lega">
                  <div className="sa-picker-head">
                    <h2>Scegli la lega</h2>
                    <button type="button" className="sa-text-btn" onClick={() => setPickerOpen(false)}>Chiudi</button>
                  </div>
                  <div className="sa-options">
                    <button type="button" className="sa-option" data-on={!selected} onClick={() => chooseLeague(null)}>
                      <span className="sa-grow">Tutte le leghe<span className="sa-option-meta">Riepilogo di {leagues.length} {leagues.length === 1 ? "lega" : "leghe"}</span></span>
                      {totalMissing > 0 ? <span className="sa-pill-bad">{totalMissing} mancanti</span> : null}
                    </button>
                    {leagues.map((league) => (
                      <button key={league.id} type="button" className="sa-option" data-on={league.id === selected?.id} onClick={() => chooseLeague(league.id)}>
                        <span className="sa-grow">
                          {league.name}
                          <span className="sa-option-meta">{league.teams} {league.teams === 1 ? "squadra" : "squadre"}{league.sandbox ? " · di prova" : ""}</span>
                        </span>
                        {missingOf(league) > 0 ? <span className="sa-pill-bad">{missingOf(league)} mancanti</span> : null}
                      </button>
                    ))}
                    {leagues.length === 0 ? <p className="sa-muted sa-small">Nessuna lega in questa stagione.</p> : null}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        <ViewSwitch to="player" className="sa-switch-top" />
      </header>

      <div className="sa-main">{children}</div>

      <nav className="sa-tabbar" aria-label="Area admin">
        {ADMIN_TABS.map((tab, index) => (
          <Link key={tab.href} href={tab.href} data-active={active === tab.href} aria-current={pathname === tab.href ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TAB_ICONS[index]}</svg>
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
