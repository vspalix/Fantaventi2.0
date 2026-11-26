import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { checkAdminPage } from "@/components/admin/AdminGate";

// Primo controllo all'apertura. Ogni pagina ripete il suo, perché nei
// passaggi tra schermate questo layout non viene rieseguito.
// Il menu compare solo a chi ha superato il controllo.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  return (
    <div className="admin-shell">
      <AdminNav />
      <div className="admin-main">{children}</div>
    </div>
  );
}
