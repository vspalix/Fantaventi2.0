"use client";

import { useState } from "react";
import type { PlatformUserRow } from "@/lib/server/platform-users";

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Richiesta non riuscita.");
  return body;
}

export function UserDesk({ initial }: { initial: PlatformUserRow[] }) {
  const [users, setUsers] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function reload() {
    const body = await readJson<{ users: PlatformUserRow[] }>(await fetch("/api/admin/users"));
    setUsers(body.users);
  }

  async function resetPassword(user: PlatformUserRow) {
    setPendingId(user.id);
    setError(null);
    try {
      await readJson(await fetch(`/api/admin/users/${user.id}`, { method: "POST" }));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reset non riuscito.");
    } finally {
      setPendingId(null);
    }
  }

  async function remove(user: PlatformUserRow) {
    const label = user.email || user.displayName || user.id;
    if (!window.confirm(`Eliminare l'account di ${label}? Rosa e iscrizioni di questa persona vengono cancellate.`)) return;
    setPendingId(user.id);
    setError(null);
    try {
      await readJson(await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" }));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Eliminazione non riuscita.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="stack">
      {error ? <p className="banner">{error}</p> : null}
      <div className="card user-table-wrap">
        <table className="user-table as-cards">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Telefono</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={4}>Nessun utente registrato.</td></tr>
            ) : users.map((user) => (
              <tr key={user.id}>
                <td data-label="Nome">
                  <strong>{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.displayName || "Senza nome"}</strong>
                  {user.mustResetPassword ? <span className="small muted"> · nuova password al prossimo accesso</span> : null}
                </td>
                <td data-label="Email">{user.email || "—"}</td>
                <td data-label="Telefono">{user.phone || "—"}</td>
                <td className="row user-actions" data-label="Azioni">
                  <button className="ghost" type="button" disabled={pendingId === user.id} onClick={() => void resetPassword(user)}>
                    Reimposta password
                  </button>
                  <button className="danger" type="button" disabled={pendingId === user.id} onClick={() => void remove(user)}>
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
