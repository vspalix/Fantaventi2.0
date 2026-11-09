"use client";

import { useEffect, useState } from "react";

type Provider = { id: string; label: string };

type Options = {
  competitions: { id: string; code: string }[];
  seasons: { id: string; code: string; competitionId: string }[];
  listoneProviders?: Provider[];
  activeSeasonId?: string | null;
};

type Result = {
  seasonCode: string;
  currentGameweek: number;
  active: number;
  created: number;
  updated: number;
  moved: number;
  released: number;
  clubsCreated: number;
};

export function ImportListone() {
  const [options, setOptions] = useState<Options | null>(null);
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [provider, setProvider] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    void fetch("/api/admin/import-options")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Opzioni non disponibili.");
        setOptions(body as Options);
        const season = body.seasons?.find((item: { id: string }) => item.id === body.activeSeasonId) ?? body.seasons?.[0];
        const competition = body.competitions?.find((item: { id: string }) => item.id === season?.competitionId) ?? body.competitions?.[0];
        setCompetitionId(competition?.id ?? "");
        setSeasonId(season?.id ?? "");
        setProvider(body.listoneProviders?.[0]?.id ?? "");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Opzioni non disponibili."));
  }, []);

  const seasons = (options?.seasons ?? []).filter((season) => season.competitionId === competitionId);

  return (
    <form
      className="card stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setPending(true);
        setError(null);
        setResult(null);
        try {
          const response = await fetch("/api/admin/import-quotations", { method: "POST", body: data });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "Import non riuscito.");
          setResult(body as Result);
          form.reset();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Import non riuscito.");
        } finally {
          setPending(false);
        }
      }}
    >
      <h2>Listino ufficiale</h2>
      <p>
        La fonte scelta normalizza calciatori, ruoli e club. Il database riceve solo quel listone,
        e il foglio dei ceduti chiude la registrazione senza cancellare lo storico.
      </p>
      {options && options.seasons.length === 0 ? (
        <p className="banner">Crea prima una lega della stagione da aggiornare.</p>
      ) : null}
      <label>
        Fonte
        <select name="provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
          {(options?.listoneProviders ?? []).map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <label>
        Competizione
        <select
          name="competitionId"
          value={competitionId}
          onChange={(event) => {
            const next = event.target.value;
            setCompetitionId(next);
            const season = options?.seasons.find((item) => item.competitionId === next);
            setSeasonId(season?.id ?? "");
          }}
        >
          {(options?.competitions ?? []).map((competition) => (
            <option key={competition.id} value={competition.id}>{competition.code}</option>
          ))}
        </select>
      </label>
      <label>
        Stagione
        <select name="seasonId" value={seasonId} onChange={(event) => setSeasonId(event.target.value)}>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>{season.code}</option>
          ))}
        </select>
      </label>
      <label>
        File .xlsx
        <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
      </label>
      <button className="primary" type="submit" disabled={pending || !seasonId}>
        {pending ? "Importo il listone…" : "Importa quotazioni"}
      </button>
      {error ? <p className="banner">{error}</p> : null}
      {result ? (
        <p className="banner ok">
          Stagione {result.seasonCode}, giornata corrente {result.currentGameweek}. Attivi {result.active}:
          {" "}{result.created} nuovi, {result.updated} aggiornati, {result.moved} trasferiti, {result.released} ceduti.
          Club creati: {result.clubsCreated}.
        </p>
      ) : null}
    </form>
  );
}
