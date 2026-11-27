import { checkAdminPage } from "@/components/admin/AdminGate";
import { EmptyState } from "@/components/EmptyState";
import { ACTION_LABEL } from "@/lib/admin-audit-labels";
import { listAdminAudit } from "@/lib/server/audit";
import { publicError } from "@/lib/server/api-error";

const WHEN = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Europe/Rome",
});


export default async function AdminAuditPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  try {
    const log = await listAdminAudit();
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Registro azioni</h1>
          <p className="lede">Ogni ricalcolo, modifica voti, cambio regole ed espulsione resta qui con data, ora e id dell&apos;admin.</p>
        </header>
        {!log.ready ? (
          <p className="banner">Per attivare il registro esegui admin_audit.sql nell&apos;editor SQL di Supabase.</p>
        ) : log.rows.length === 0 ? (
          <EmptyState title="Nessuna azione registrata">
            Il registro si riempie quando ricalcoli una giornata, carichi dei voti, cambi le regole di una lega o espelli un utente.
          </EmptyState>
        ) : (
          <div className="card user-table-wrap">
            <table className="user-table as-cards">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Azione</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {log.rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Quando">{WHEN.format(new Date(row.createdAt))}</td>
                    <td data-label="Azione">
                      <strong>{ACTION_LABEL[row.action] ?? row.action}</strong>
                      {row.targetId ? <span className="small muted"> · {row.targetType} {row.targetId}</span> : null}
                    </td>
                    <td data-label="Admin">
                      <strong>{row.adminName}</strong>
                      <span className="small muted"> · {row.adminId}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <h1 className="section-title">Registro azioni</h1>
        <p className="banner">{publicError("Admin: Registro", error).message}</p>
      </section>
    );
  }
}
