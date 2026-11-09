import type { ReactNode } from "react";
import Link from "next/link";
import { ModeSwitch } from "@/components/ModeSwitch";
import { isSuperAdmin } from "@/lib/server/platform-role";
import { getSessionUser } from "@/lib/server/session";
import { readViewMode } from "@/lib/server/view-mode";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (user && !(await isSuperAdmin(user.id))) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Laboratorio</h1>
          <p className="lede">Quest&apos;area è riservata al super admin della piattaforma: voti, calendario e sincronizzazioni.</p>
        </header>
        <p>La gestione della tua lega, inviti, partecipanti, bonus e formato, sta nella scheda Gestione, visibile in vista admin.</p>
        <Link className="primary" href="/leghe">Vai alle leghe</Link>
      </section>
    );
  }
  if (user && await readViewMode() !== "host") {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Vista giocatore</h1>
          <p className="lede">Il Laboratorio resta chiuso finché non passi alla vista admin.</p>
        </header>
        <ModeSwitch mode="player" />
      </section>
    );
  }
  return children;
}
