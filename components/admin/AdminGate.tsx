import type { User } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import Link from "next/link";
import { ModeSwitch } from "@/components/ModeSwitch";
import { publicError } from "@/lib/server/api-error";
import { isSuperAdmin } from "@/lib/server/platform-role";
import { getSessionUser, SESSION_UNAVAILABLE, sessionUnavailable } from "@/lib/server/session";
import { readViewMode } from "@/lib/server/view-mode";

type AdminGate = { ok: true; user: User } | { ok: false; screen: ReactNode };

function Reserved({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">Pagina riservata</h1>
        <p className="lede">{text}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * Controllo di ogni pagina sotto /admin. Va chiamato dalla pagina stessa:
 * nei passaggi tra schermate il layout non viene rieseguito.
 * Chi non è super admin vede solo una schermata neutra, senza titoli,
 * menu o riquadri dell'area admin.
 */
export async function checkAdminPage(): Promise<AdminGate> {
  const user = await getSessionUser();
  if (!user) {
    if (await sessionUnavailable()) return { ok: false, screen: <Reserved text={SESSION_UNAVAILABLE} /> };
    return {
      ok: false,
      screen: (
        <Reserved text="Entra con il tuo account per continuare.">
          <Link className="primary" href="/accesso">Entra</Link>
        </Reserved>
      ),
    };
  }

  let allowed = false;
  try {
    allowed = await isSuperAdmin(user.id);
  } catch (error) {
    return { ok: false, screen: <Reserved text={publicError("Admin: verifica permessi", error).message} /> };
  }
  if (!allowed) {
    return {
      ok: false,
      screen: (
        <Reserved text="Questa pagina non è disponibile per il tuo account.">
          <Link className="primary" href="/leghe">Vai alle leghe</Link>
        </Reserved>
      ),
    };
  }

  if (await readViewMode() !== "host") {
    return {
      ok: false,
      screen: (
        <section className="stack">
          <header>
            <h1 className="section-title">Vista giocatore</h1>
            <p className="lede">La vista admin resta chiusa finché non passi da Giocatore ad Admin.</p>
          </header>
          <ModeSwitch mode="player" />
        </section>
      ),
    };
  }

  return { ok: true, user };
}
