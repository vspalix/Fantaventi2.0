import { checkAdminPage } from "@/components/admin/AdminGate";
import { AdminNav } from "@/components/admin/AdminNav";
import { EmptyState } from "@/components/EmptyState";
import { listAdminAudit } from "@/lib/server/audit";
import { publicError } from "@/lib/server/api-error";

const WHEN = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Europe/Rome",
});

const ACTION_LABEL: Record<string, string> = {
  "gameweek.recalculate": "Ricalcolo forzato di una giornata",
  "gameweek.calculate": "Calcolo punteggi di una giornata",
  "votes.recover": "Recupero voti della giornata",
  "votes.manual": "Modifica manuale dei voti",
  "match.postponed": "Rinvio di una partita",
  "match.hold": "Stato di una partita rinviata o sospesa",
  "gameweek.recalculate_partial": "Ricalcolo parziale di una giornata",
  "league.rules": "Cambio regole della lega",
  "league.expel": "Espulsione di un utente",
  "user.delete": "Eliminazione di un account",
  "user.role": "Cambio ruolo di piattaforma",
  "live.force": "Sync e ricalcolo forzati della giornata corrente",
  "sandbox.seed": "Generazione lega sandbox",
  "sandbox.simulate": "Simulazione giornate sandbox",
  "sandbox.reset": "Svuotamento sandbox",
};

export default async function AdminAuditPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  try {
    const log = await listAdminAudit();
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Registro</h1>
          <p className="lede">Ogni ricalcolo, modifica voti, cambio regole ed espulsione resta qui con data, ora e id dell&apos;admin.</p>
        </header>
        <AdminNav />
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
        <h1 className="section-title">Registro</h1>
        <AdminNav />
        <p className="banner">{publicError("Admin: Registro", error).message}</p>
      </section>
    );
  }
}
