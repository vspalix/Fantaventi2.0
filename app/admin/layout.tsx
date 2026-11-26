import type { ReactNode } from "react";
import { checkAdminPage } from "@/components/admin/AdminGate";

// Primo controllo all'apertura. Ogni pagina ripete il suo, perché nei
// passaggi tra schermate questo layout non viene rieseguito.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  return children;
}
