import type { ReactNode } from "react";
import { Jost } from "next/font/google";
import { AdminShell, type ShellLeague } from "@/components/admin/AdminShell";
import { checkAdminPage } from "@/components/admin/AdminGate";
import { resolveAdminLeague } from "@/lib/server/admin-area";
import { reportIfTechnical } from "@/lib/server/error-report";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";

const jost = Jost({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-jost" });

function initialsOf(email: string | undefined) {
  const name = (email ?? "").split("@")[0].replace(/[^a-z]/gi, "");
  return (name.slice(0, 2) || "SA").toUpperCase();
}

// Primo controllo all'apertura. Ogni pagina ripete il suo, perché nei
// passaggi tra schermate questo layout non viene rieseguito.
// Intestazione, menu e selettore della lega compaiono solo a chi ha superato il controllo.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;

  let leagues: ShellLeague[] = [];
  let selectedId: string | null = null;
  if (hasServiceSupabaseEnv()) {
    try {
      const resolved = await resolveAdminLeague();
      leagues = resolved.data.leagues;
      selectedId = resolved.selected?.id ?? null;
    } catch (error) {
      // Il menu resta utilizzabile anche se l'elenco delle leghe non si legge.
      reportIfTechnical("Admin: elenco leghe del selettore", error);
    }
  }

  return (
    <div className={jost.variable}>
      <AdminShell leagues={leagues} selectedId={selectedId} initials={initialsOf(gate.user.email)}>
        {children}
      </AdminShell>
    </div>
  );
}
