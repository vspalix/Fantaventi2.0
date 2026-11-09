"use client";

import { useEffect, useMemo, useState } from "react";

type Season = { id: string; code: string; competitionId: string };
type Competition = { id: string; code: string };
type RoleFilter = "" | "P" | "D" | "C" | "A";

type ListonePlayer = {
  id: string;
  name: string;
  roleLabel: "P" | "D" | "C" | "A";
  roleLocked: boolean;
  club: string;
  status: "active" | "released";
};

type ListonePayload = {
  competition: string;
  season: string;
  summary: { active: number; released: number; total: number };
  clubs: string[];
  players: ListonePlayer[];
};

const ROLES: RoleFilter[] = ["", "P", "D", "C", "A"];

export function ListoneView() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [role, setRole] = useState<RoleFilter>("");
  const [club, setClub] = useState("");
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<ListonePayload | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function correctRole(playerId: string, nextRole: Exclude<RoleFilter, "">) {
    setSavingId(playerId);
    setError(null);
    try {
      const response = await fetch("/api/admin/listone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId: playerId, role: nextRole }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Correzione non riuscita.");
      setPayload((current) => current && ({
        ...current,
        players: current.players.map((player) => (
          player.id === playerId ? { ...player, roleLabel: nextRole, roleLocked: true } : player
        )),
      }));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Correzione non riuscita.");
    } finally {
      setSavingId(null);
    }
  }

  useEffect(() => {
    void fetch("/api/admin/import-options")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Opzioni non disponibili.");
        const nextCompetitions = (body.competitions ?? []) as Competition[];
        const nextSeasons = (body.seasons ?? []) as Season[];
        setCompetitions(nextCompetitions);
        setSeasons(nextSeasons);
        const season = nextSeasons.find((item) => item.id === body.activeSeasonId)
          ?? nextSeasons[0];
        const competition = nextCompetitions.find((item) => item.id === season?.competitionId) ?? nextCompetitions[0];
        setCompetitionId(competition?.id ?? "");
        setSeasonId(season?.id ?? "");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Opzioni non disponibili."));
  }, []);

  const competition = competitions.find((item) => item.id === competitionId);
  const seasonChoices = seasons.filter((item) => item.competitionId === competitionId);
  const season = seasonChoices.find((item) => item.id === seasonId) ?? seasonChoices[0];

  useEffect(() => {
    if (!competition || !season) return;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    void fetch(`/api/admin/listone?competition=${encodeURIComponent(competition.code)}&season=${encodeURIComponent(season.code)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Listone non disponibile.");
        setPayload(body as ListonePayload);
        setClub("");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setPayload(null);
        setError(cause instanceof Error ? cause.message : "Listone non disponibile.");
      })
      .finally(() => setPending(false));
    return () => controller.abort();
  }, [competition, season]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("it");
    return (payload?.players ?? []).filter((player) => {
      if (role && player.roleLabel !== role) return false;
      if (club && player.club !== club) return false;
      if (needle && !player.name.toLocaleLowerCase("it").includes(needle)) return false;
      return true;
    });
  }, [payload, role, club, query]);

  return (
    <div className="stack">
      <div className="row admin-controls">
        <label>
          Competizione
          <select
            value={competitionId}
            onChange={(event) => {
              const nextId = event.target.value;
              setCompetitionId(nextId);
              const nextSeason = seasons.find((item) => item.competitionId === nextId);
              setSeasonId(nextSeason?.id ?? "");
            }}
          >
            {competitions.map((item) => (
              <option key={item.id} value={item.id}>{item.code}</option>
            ))}
          </select>
        </label>
        <label>
          Stagione
          <select value={season?.id ?? ""} onChange={(event) => setSeasonId(event.target.value)}>
            {seasonChoices.map((item) => (
              <option key={item.id} value={item.id}>{item.code}</option>
            ))}
          </select>
        </label>
        <label>
          Squadra
          <select value={club} onChange={(event) => setClub(event.target.value)}>
            <option value="">Tutte</option>
            {(payload?.clubs ?? []).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Calciatore
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca per nome"
          />
        </label>
      </div>

      <div className="filters" role="group" aria-label="Ruolo">
        {ROLES.map((item) => (
          <button
            key={item || "tutti"}
            type="button"
            className="chip"
            data-active={role === item}
            onClick={() => setRole(item)}
          >
            {item || "Tutti"}
          </button>
        ))}
      </div>

      {error ? <p className="banner">{error}</p> : null}

      <div className="summary-grid">
        <div className="stat">
          Attivi
          <strong>{payload?.summary.active ?? "—"}</strong>
        </div>
        <div className="stat">
          Ceduti
          <strong>{payload?.summary.released ?? "—"}</strong>
        </div>
        <div className="stat">
          In elenco
          <strong>{visible.length}</strong>
        </div>
      </div>

      <p className="small muted">
        Nel listone Serie A il ruolo è la colonna B, la R (P, D, C, A). La colonna RM non conta.
        Se un attivo è nel ruolo sbagliato, correggilo qui. Dopo aver eseguito role_correction.sql la correzione resta anche al prossimo import.
      </p>

      <div className="card listone-scroll">
        {pending && !payload ? <p>Caricamento del listone…</p> : null}
        {payload && visible.length === 0 ? <p>Nessun calciatore con questi filtri.</p> : null}
        {visible.length > 0 ? (
          <table className="standings">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Ruolo</th>
                <th>Squadra</th>
                <th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((player) => (
                <tr key={player.id}>
                  <td>{player.name}</td>
                  <td>
                    {player.status === "active" ? (
                      <select
                        aria-label={`Ruolo di ${player.name}`}
                        value={player.roleLabel}
                        disabled={savingId === player.id}
                        onChange={(event) => {
                          const nextRole = event.target.value as Exclude<RoleFilter, "">;
                          if (nextRole !== player.roleLabel) void correctRole(player.id, nextRole);
                        }}
                      >
                        {ROLES.filter((item): item is Exclude<RoleFilter, ""> => item !== "").map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    ) : player.roleLabel}
                    {player.roleLocked ? <span className="small muted"> corretto</span> : null}
                  </td>
                  <td>{player.club}</td>
                  <td>
                    <span className="status-pill">{player.status === "active" ? "Attivo" : "Ceduto"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
