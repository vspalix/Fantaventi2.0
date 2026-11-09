"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Laboratorio" },
  { href: "/admin/leghe", label: "Leghe" },
  { href: "/admin/notifiche", label: "Notifiche" },
  { href: "/admin/news", label: "News" },
  { href: "/admin/import-listone", label: "Listone" },
  { href: "/admin/listone-view", label: "Listone caricato" },
  { href: "/admin/import-voti", label: "Voti" },
  { href: "/admin/rules-editor", label: "Regolamento" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Amministrazione">
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
