"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PlatformLeagueRow = {
  id: string;
  name: string;
  joinCode: string;
  seasonCode: string;
  ownerName: string;
  format: string;
  members: number;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Richiesta non riuscita.");
  return body;
}

export function PlatformControl() {
  const [leagues, setLeagues] = useState<PlatformLeagueRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [gameweekId, setGameweekId] = useState("");
  const [delegateUserId, setDelegateUserId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/platform-leagues")
      .then((response) => readJson<{ leagues: PlatformLeagueRow[] }>(response))
      .then((body) => {
        setLeagues(body.leagues);
        setSelectedId(body.leagues[0]?.id ?? "");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Elenco non disponibile."));
  }, []);

  const selected = leagues.find((league) => league.id === selectedId) ?? null;

  async function run(body: Record<string, string>) {
    if (!selected) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await readJson<{ unlocked?: { gameweekNumber: number; lineups: number } | null }>(await fetch(`/api/admin/platform-leagues/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      setMessage(result.unlocked
        ? `Formazioni della giornata ${result.unlocked.gameweekNumber} riaperte: ${result.unlocked.lineups}.`
        : "Override applicato.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Override non riuscito.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Tutte le leghe</h2>
        <p className="small muted">Come super admin puoi aprire qualunque lega, nominare un admin e sbloccare le formazioni di una giornata non ancora calcolata. I voti di stagione si correggono da Voti.</p>
        {leagues.length === 0 ? <p>Nessuna lega.</p> : (
          <table>
            <thead>
              <tr>
                <th>Lega</th>
                <th>Stagione</th>
                <th>Formato</th>
                <th>Admin</th>
                <th>Squadre</th>
              </tr>
            </thead>
            <tbody>
              {leagues.map((league) => (
                <tr key={league.id}>
                  <td>
                    <button className="text-button" type="button" onClick={() => setSelectedId(league.id)}>{league.name}</button>
                  </td>
                  <td>{league.seasonCode}</td>
                  <td>{league.format}</td>
                  <td>{league.ownerName}</td>
                  <td>{league.members}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {selected ? (
        <section className="card stack">
          <h2>Override · {selected.name}</h2>
          <p className="small muted">Codice {selected.joinCode}. Admin attuale: {selected.ownerName}.</p>
          <Link className="primary" href={`/leghe/${selected.id}`}>Apri la lega e modifica le regole</Link>
          <label>
            Id utente da nominare admin di lega
            <input value={delegateUserId} onChange={(event) => setDelegateUserId(event.target.value)} placeholder="uuid del partecipante" />
          </label>
          <div className="row">
            <button className="ghost" type="button" disabled={pending || delegateUserId.trim().length < 8} onClick={() => void run({ grantDelegateUserId: delegateUserId.trim() })}>
              Nomina admin
            </button>
            <button className="ghost" type="button" disabled={pending || delegateUserId.trim().length < 8} onClick={() => void run({ revokeDelegateUserId: delegateUserId.trim() })}>
              Revoca admin
            </button>
          </div>
          <label>
            Id giornata da sbloccare
            <input value={gameweekId} onChange={(event) => setGameweekId(event.target.value)} placeholder="uuid della giornata" />
          </label>
          <button className="ghost" type="button" disabled={pending || gameweekId.trim().length < 8} onClick={() => void run({ unlockGameweekId: gameweekId.trim() })}>
            Sblocca formazioni
          </button>
          <Link href="/admin/import-voti">Correggi i voti di stagione</Link>
        </section>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      {message ? <p className="banner ok">{message}</p> : null}
    </div>
  );
}
