"use client";

import { useRef, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { useShown } from "@/components/ShowMore";
import type { PlatformUserRow } from "@/lib/server/platform-users";

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Richiesta non riuscita.");
  return body;
}

export function UserDesk({ initial, currentUserId }: { initial: PlatformUserRow[]; currentUserId: string }) {
  const [users, setUsers] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const flight = useRef(false);
  const roleMissing = users.length > 0 && users.every((user) => user.platformRole === "unknown");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const found = needle
    ? users.filter((user) => [user.firstName, user.lastName, user.displayName, user.email].join(" ").toLowerCase().includes(needle))
    : users;
  const { shown, more } = useShown(found, 50, "altri");

  async function reload() {
    const body = await readJson<{ users: PlatformUserRow[] }>(await fetch("/api/admin/users"));
    setUsers(body.users);
  }

  async function resetPassword(user: PlatformUserRow) {
    if (flight.current) return;
    flight.current = true;
    setPendingId(user.id);
    setError(null);
    try {
      await readJson(await fetch(`/api/admin/users/${user.id}`, { method: "POST" }));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reset non riuscito.");
    } finally {
      flight.current = false;
      setPendingId(null);
    }
  }

  async function setRole(user: PlatformUserRow, platformRole: "member" | "super_admin") {
    if (flight.current || user.id === currentUserId) return;
    flight.current = true;
    const label = user.email || user.displayName || user.id;
    const confirmed = window.confirm(
      platformRole === "super_admin"
        ? `Rendere ${label} super admin? Avrà laboratorio, voti, registro e le stesse azioni tue.`
        : `Togliere il super admin a ${label}? Resta un giocatore normale.`,
    );
    if (!confirmed) {
      flight.current = false;
      return;
    }
    setPendingId(user.id);
    setError(null);
    try {
      await readJson(await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformRole }),
      }));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cambio ruolo non riuscito.");
    } finally {
      flight.current = false;
      setPendingId(null);
    }
  }

  async function remove(user: PlatformUserRow) {
    if (flight.current) return;
    flight.current = true;
    const label = user.email || user.displayName || user.id;
    if (!window.confirm(`Eliminare l'account di ${label}? Rosa e iscrizioni di questa persona vengono cancellate.`)) {
      flight.current = false;
      return;
    }
    setPendingId(user.id);
    setError(null);
    try {
      await readJson(await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" }));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Eliminazione non riuscita.");
    } finally {
      flight.current = false;
      setPendingId(null);
    }
  }

  return (
    <div className="stack">
      {roleMissing ? <p className="banner">Per nominare un super admin esegui platform_access.sql nell&apos;editor SQL.</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {users.length > 20 ? (
        <input type="search" aria-label="Cerca un utente" placeholder="Cerca per nome o email" value={search} onChange={(event) => setSearch(event.target.value)} />
      ) : null}
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
            ) : found.length === 0 ? (
              <tr><td colSpan={4}>Nessun utente con questo nome.</td></tr>
            ) : shown.map((user) => (
              <tr key={user.id}>
                <td data-label="Nome">
                  <strong>{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.displayName || "Senza nome"}</strong>
                  {user.platformRole === "super_admin" ? <span className="small muted"> · super admin</span> : null}
                  {user.mustResetPassword ? <span className="small muted"> · nuova password al prossimo accesso</span> : null}
                </td>
                <td data-label="Email">{user.email || "—"}</td>
                <td data-label="Telefono">{user.phone || "—"}</td>
                <td className="row user-actions" data-label="Azioni">
                  <button className="ghost" type="button" disabled={pendingId !== null} aria-busy={pendingId === user.id} onClick={() => void resetPassword(user)}>
                    <BusyLabel pending={pendingId === user.id} idle="Reimposta password" busy="Attendi..." />
                  </button>
                  {user.id !== currentUserId && user.platformRole !== "unknown" ? (
                    <button
                      className="ghost"
                      type="button"
                      disabled={pendingId !== null}
                      aria-busy={pendingId === user.id}
                      onClick={() => void setRole(user, user.platformRole === "super_admin" ? "member" : "super_admin")}
                    >
                      <BusyLabel
                        pending={pendingId === user.id}
                        idle={user.platformRole === "super_admin" ? "Togli super admin" : "Rendi super admin"}
                        busy="Attendi..."
                      />
                    </button>
                  ) : null}
                  {user.id !== currentUserId ? (
                    <button className="danger" type="button" disabled={pendingId !== null} aria-busy={pendingId === user.id} onClick={() => void remove(user)}>
                      <BusyLabel pending={pendingId === user.id} idle="Elimina" busy="Attendi..." />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more}
    </div>
  );
}
