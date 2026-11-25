"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Giornata" },
  { href: "/admin/import-voti", label: "Voti" },
  { href: "/admin/utenti", label: "Utenti" },
  { href: "/admin/registro", label: "Registro" },
  { href: "/admin/leghe", label: "Leghe" },
  { href: "/admin/notifiche", label: "Notifiche" },
  { href: "/admin/news", label: "News" },
  { href: "/admin/annunci", label: "Annunci" },
  { href: "/admin/comunicazioni", label: "Comunicazioni" },
  { href: "/admin/promo", label: "Banner" },
  { href: "/admin/sponsor", label: "Sponsor" },
  { href: "/admin/import-listone", label: "Listone" },
  { href: "/admin/listone-view", label: "Listone caricato" },
  { href: "/admin/rules-editor", label: "Regolamento" },
  { href: "/admin/laboratorio", label: "Collaudo" },
  { href: "/admin/laboratorio/colori", label: "Colori" },
  { href: "/admin/laboratorio/indisponibili", label: "Indisponibili" },
  { href: "/admin/laboratorio/sincronizzazioni", label: "Sincronizzazioni" },
  { href: "/admin/laboratorio/diagnostica", label: "Diagnostica" },
  { href: "/admin/laboratorio/brand", label: "Brand & Grafica" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="tabs scroll-tabs" aria-label="Amministrazione">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          className="tab"
          href={link.href}
          data-active={pathname === link.href}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
