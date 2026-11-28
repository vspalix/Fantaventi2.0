"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useShown } from "@/components/ShowMore";
import { ADMIN_GROUPS, ADMIN_HOME, ADMIN_LEAGUE_COOKIE, type AdminScope } from "@/lib/admin-area";

export type ShellLeague = { id: string; name: string; sandbox: boolean; teams: number; filed: number };

function ScopeChip({ scope }: { scope: AdminScope }) {
  return scope === "league"
    ? <span className="sa-chip sa-chip-league">Per lega</span>
    : <span className="sa-chip">Globale</span>;
}

function missingOf(league: ShellLeague) {
  return Math.max(0, league.teams - league.filed);
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function AdminShell({
  leagues,
  selectedId,
  initials,
  children,
}: {
  leagues: ShellLeague[];
  selectedId: string | null;
  initials: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const picker = useShown(leagues, 50);
  const menuRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const selected = leagues.find((league) => league.id === selectedId) ?? null;
  const totalMissing = leagues.filter((league) => !league.sandbox).reduce((sum, league) => sum + missingOf(league), 0);
  const missing = selected ? missingOf(selected) : totalMissing;

  useEffect(() => {
    setMenuOpen(false);
    setPickerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen && !pickerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, pickerOpen]);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>("a, input, button")?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && pickerRef.current?.contains(event.target)) return;
      setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pickerOpen]);

  function chooseLeague(id: string | null) {
    document.cookie = id
      ? `${ADMIN_LEAGUE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`
      : `${ADMIN_LEAGUE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    setPickerOpen(false);
    // Ricarica completa: con router.refresh() la pagina restava un passo indietro.
    window.location.reload();
  }

  const needle = query.trim().toLowerCase();
  const groups = ADMIN_GROUPS.map((group) => ({
    ...group,
    sections: group.sections.filter((section) => !needle || `${section.label} ${section.hint}`.toLowerCase().includes(needle)),
  })).filter((group) => group.sections.length > 0);

  return (
    <div className="sa-root">
      <header className="sa-top">
        <button
          type="button"
          className="sa-icon-btn"
          aria-label="Apri il menu delle sezioni"
          aria-expanded={menuOpen}
          aria-controls="sa-menu"
          onClick={() => setMenuOpen(true)}
        >
          <MenuIcon />
        </button>
        <Link href="/admin" className="sa-brand">
          <span className="sa-brand-name">FantaVenti</span>
          <span className="sa-chip sa-chip-league">Superadmin</span>
        </Link>
        <span className="sa-spacer" />
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
              <div className="sa-scrim sa-picker-scrim" aria-hidden="true" />
              <div className="sa-picker-panel" role="dialog" aria-label="Scegli la lega">
                <div className="sa-picker-head">
                  <h2>Scegli la lega</h2>
                  <button type="button" className="sa-text-btn" onClick={() => setPickerOpen(false)}>Chiudi</button>
                </div>
                <p className="sa-muted sa-small">Cambiano solo le sezioni «per lega». Voti, giornata, utenti e sistema restano uguali.</p>
                <div className="sa-options">
                  <button type="button" className="sa-option" data-on={!selected} onClick={() => chooseLeague(null)}>
                    <span className="sa-grow">Tutte le leghe<span className="sa-option-meta">Riepilogo di {leagues.length} {leagues.length === 1 ? "lega" : "leghe"}</span></span>
                    {totalMissing > 0 ? <span className="sa-pill-bad">{totalMissing} mancanti</span> : null}
                  </button>
                  {picker.shown.map((league) => (
                    <button key={league.id} type="button" className="sa-option" data-on={league.id === selected?.id} onClick={() => chooseLeague(league.id)}>
                      <span className="sa-grow">
                        {league.name}
                        <span className="sa-option-meta">{league.teams} squadre{league.sandbox ? " · di prova" : ""}</span>
                      </span>
                      {missingOf(league) > 0 ? <span className="sa-pill-bad">{missingOf(league)} mancanti</span> : null}
                    </button>
                  ))}
                  {picker.more}
                  {leagues.length === 0 ? <p className="sa-muted sa-small">Nessuna lega in questa stagione.</p> : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
        <a className="sa-btn sa-btn-dark sa-hide-phone" href="/">Torna all&apos;app</a>
        <span className="sa-avatar" role="img" aria-label="Il tuo account">{initials}</span>
      </header>

      {menuOpen ? (
        <>
          <button type="button" className="sa-scrim" aria-label="Chiudi il menu" onClick={() => setMenuOpen(false)} />
          <nav id="sa-menu" className="sa-drawer" aria-label="Sezioni superadmin" ref={menuRef}>
            <div className="sa-drawer-head">
              <button type="button" className="sa-icon-btn" aria-label="Chiudi il menu" onClick={() => setMenuOpen(false)}>
                <CloseIcon />
              </button>
              <div className="sa-drawer-title">
                <span className="sa-brand-name">Sezioni</span>
                <span className="sa-muted sa-small">Lega scelta: {selected?.name ?? "Tutte le leghe"}</span>
              </div>
              <label className="sa-search">
                <span className="sa-sr">Cerca una sezione</span>
                <input type="search" placeholder="Cerca una sezione" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
            </div>
            <div className="sa-drawer-body">
              {!needle ? (
                <Link className="sa-item sa-item-home" href={ADMIN_HOME.href} data-active={pathname === ADMIN_HOME.href} aria-current={pathname === ADMIN_HOME.href ? "page" : undefined}>
                  <span className="sa-item-label">{ADMIN_HOME.label}</span>
                  <span className="sa-item-hint">{ADMIN_HOME.hint}</span>
                </Link>
              ) : null}
              <div className="sa-groups">
                {groups.map((group) => (
                  <div className="sa-group" key={group.title}>
                    <div className="sa-group-head">
                      <span className="sa-cap">{group.scope === "league" && selected ? selected.name : group.title}</span>
                      <ScopeChip scope={group.scope} />
                    </div>
                    {group.sections.map((section) => {
                      const active = pathname === section.href;
                      return (
                        <Link key={section.href} className="sa-item" href={section.href} data-active={active} aria-current={active ? "page" : undefined}>
                          <span className="sa-item-label">{section.label}</span>
                          {section.href === "/admin/formazioni" && missing > 0
                            ? <span className="sa-badge" aria-label={`${missing} formazioni mancanti`}>{missing}</span>
                            : <span className="sa-item-hint">{section.hint}</span>}
                        </Link>
                      );
                    })}
                  </div>
                ))}
                {groups.length === 0 ? <p className="sa-muted">Nessuna sezione con questo nome.</p> : null}
              </div>
            </div>
            <div className="sa-drawer-foot">
              <a className="sa-btn sa-btn-line" href="/">Torna all&apos;app da giocatore</a>
            </div>
          </nav>
        </>
      ) : null}

      <div className="sa-main">{children}</div>
    </div>
  );
}

export { ScopeChip };
