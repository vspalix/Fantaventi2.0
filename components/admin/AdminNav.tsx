"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type AdminLink = { href: string; label: string; hint: string };
type AdminGroup = { title: string; links: AdminLink[] };

// Le pagine del pannello divise per argomento: un gruppo per ogni tipo di lavoro.
const GROUPS: AdminGroup[] = [
  {
    title: "Giornata",
    links: [
      { href: "/admin", label: "Giornata in corso", hint: "Sync live, punteggi, rinvii" },
      { href: "/admin/import-voti", label: "Voti", hint: "Carica e correggi i voti" },
      { href: "/admin/laboratorio/indisponibili", label: "Indisponibili", hint: "Infortunati e squalificati" },
      { href: "/admin/laboratorio/sincronizzazioni", label: "Sincronizzazioni", hint: "Fonti e letture automatiche" },
    ],
  },
  {
    title: "Persone e leghe",
    links: [
      { href: "/admin/utenti", label: "Utenti", hint: "Account e ruoli" },
      { href: "/admin/leghe", label: "Leghe", hint: "Tutte le leghe e gli admin" },
      { href: "/admin/registro", label: "Registro", hint: "Storico delle azioni admin" },
    ],
  },
  {
    title: "Comunicazione",
    links: [
      { href: "/admin/notifiche", label: "Notifiche", hint: "Messaggi push" },
      { href: "/admin/annunci", label: "Annunci", hint: "Avvisi all'apertura dell'app" },
      { href: "/admin/comunicazioni", label: "Comunicazioni", hint: "Messaggio a tutti, prima una prova" },
      { href: "/admin/news", label: "News", hint: "Avvisi in home" },
      { href: "/admin/promo", label: "Banner", hint: "Immagine nella dashboard" },
      { href: "/admin/sponsor", label: "Sponsor", hint: "Striscia dei loghi" },
    ],
  },
  {
    title: "Calciatori e regole",
    links: [
      { href: "/admin/import-listone", label: "Importa listone", hint: "Carica le quotazioni" },
      { href: "/admin/listone-view", label: "Listone caricato", hint: "Controlla club e ruoli" },
      { href: "/admin/rules-editor", label: "Regolamento", hint: "Testo ufficiale delle leghe" },
    ],
  },
  {
    title: "Sistema",
    links: [
      { href: "/admin/laboratorio", label: "Collaudo", hint: "Prove, sandbox, manutenzione" },
      { href: "/admin/laboratorio/diagnostica", label: "Diagnostica", hint: "Ultimi giri e anomalie" },
      { href: "/admin/laboratorio/colori", label: "Colori sociali", hint: "Colori e loghi dei club" },
      { href: "/admin/laboratorio/brand", label: "Brand e grafica", hint: "Logo, icone, accento" },
    ],
  },
];

function findCurrent(pathname: string) {
  for (const group of GROUPS) {
    const link = group.links.find((item) => item.href === pathname);
    if (link) return { group, link };
  }
  return { group: GROUPS[0], link: GROUPS[0].links[0] };
}

function GroupList({ pathname, onPick }: { pathname: string; onPick?: () => void }) {
  return (
    <>
      {GROUPS.map((group) => (
        <div className="admin-nav-group" key={group.title}>
          <p className="admin-nav-title">{group.title}</p>
          <ul>
            {group.links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    className="admin-nav-link"
                    href={link.href}
                    data-active={active}
                    aria-current={active ? "page" : undefined}
                    onClick={onPick}
                  >
                    <span className="admin-nav-label">{link.label}</span>
                    <span className="admin-nav-hint">{link.hint}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

export function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = findCurrent(pathname);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <nav className="admin-sidebar" aria-label="Pannello admin">
        <p className="admin-sidebar-head">Pannello admin</p>
        <GroupList pathname={pathname} />
      </nav>

      <div className="admin-mobile-nav">
        <button
          type="button"
          className="admin-switcher"
          aria-expanded={open}
          aria-controls="admin-mobile-menu"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="admin-switcher-text">
            <span className="admin-switcher-group">{current.group.title}</span>
            <span className="admin-switcher-page">{current.link.label}</span>
          </span>
          <span className="admin-switcher-action">{open ? "Chiudi" : "Sezioni"}</span>
        </button>
        {open ? (
          <nav id="admin-mobile-menu" className="admin-mobile-menu" aria-label="Pannello admin">
            <GroupList pathname={pathname} onPick={() => setOpen(false)} />
          </nav>
        ) : null}
      </div>
    </>
  );
}
