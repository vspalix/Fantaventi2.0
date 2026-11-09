"use client";

import { useEffect, useState } from "react";
import { LoadedVotes } from "@/components/admin/LoadedVotes";

type Provider = { id: string; label: string };
type Gameweek = { id: string; number: number; status: string; seasonId: string };
type Season = { id: string; code: string };

type Result = {
  gameweekNumber: number;
  payloadHash: string;
  rated: number;
  skippedWithoutVote: number;
  unknown: number;
  provisionalTeams: number;
  officialRecalculated: boolean;
};

export function ImportVoti() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [gameweeks, setGameweeks] = useState<Gameweek[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [gameweekId, setGameweekId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    void fetch("/api/admin/import-options")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Opzioni non disponibili.");
        const nextSeasons = (body.seasons ?? []) as Season[];
        const nextWeeks = (body.gameweeks ?? []) as Gameweek[];
        setSeasons(nextSeasons);
        setGameweeks(nextWeeks);
        const nextProviders = (body.voteProviders ?? []) as Provider[];
        setProviders(nextProviders);
        setProvider(nextProviders[0]?.id ?? "");
        const season = nextSeasons[0]?.id ?? "";
        setSeasonId(season);
        const week = nextWeeks.find((item) => item.seasonId === season);
        setGameweekId(week?.id ?? "");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Opzioni non disponibili."));
  }, []);

  const weeks = gameweeks.filter((gameweek) => gameweek.seasonId === seasonId);

  return (
    <div className="stack">
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
          const response = await fetch("/api/admin/import-votes", { method: "POST", body: data });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "Import non riuscito.");
          setResult(body as Result);
          setReloadToken((token) => token + 1);
          form.reset();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Import non riuscito.");
        } finally {
          setPending(false);
        }
      }}
    >
      <h2>Voti di giornata</h2>
      <p>
        La fonte scelta normalizza voti, bonus e malus e sovrascrive i voti degli stessi calciatori.
        Se la giornata è già calcolata, il totale ufficiale viene ricalcolato. Con la sostituzione
        puoi ricaricare anche lo stesso file.
      </p>
      <label>
        Fonte
        <select name="provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
          {providers.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <label>
        Stagione
        <select
          value={seasonId}
          onChange={(event) => {
            const next = event.target.value;
            setSeasonId(next);
            const week = gameweeks.find((item) => item.seasonId === next);
            setGameweekId(week?.id ?? "");
          }}
        >
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>{season.code}</option>
          ))}
        </select>
      </label>
      <label>
        Giornata
        <select name="gameweekId" value={gameweekId} onChange={(event) => setGameweekId(event.target.value)}>
          {weeks.map((gameweek) => (
            <option key={gameweek.id} value={gameweek.id}>
              Giornata {gameweek.number} · {gameweek.status}
            </option>
          ))}
        </select>
      </label>
      <label>
        File .xlsx
        <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
      </label>
      <label className="row">
        <input name="replace" type="checkbox" value="1" />
        Sostituisci i voti già caricati per questa giornata
      </label>
      <button className="primary" type="submit" disabled={pending || !gameweekId}>
        {pending ? "Importo i voti e calcolo il live…" : "Importa voti"}
      </button>
      {error ? <p className="banner">{error}</p> : null}
      {result ? (
        <p className="banner ok">
          Giornata {result.gameweekNumber}: {result.rated} voti scritti, {result.skippedWithoutVote} senza voto lasciati invariati,
          {" "}{result.unknown} codici sconosciuti, {result.provisionalTeams} squadre ricalcolate in live.
          {result.officialRecalculated ? " Totale ufficiale ricalcolato: la giornata è in appello." : ""}
          Hash {result.payloadHash.slice(0, 12)}.
        </p>
      ) : null}
    </form>
    <form
      className="card stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        data.set("provider", "emergency-votes");
        data.set("gameweekId", gameweekId);
        setPending(true);
        setError(null);
        setResult(null);
        try {
          const response = await fetch("/api/admin/import-votes", { method: "POST", body: data });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "File di emergenza rifiutato.");
          setResult({
            gameweekNumber: body.gameweekNumber,
            payloadHash: body.payloadHash,
            rated: body.rated,
            skippedWithoutVote: 0,
            unknown: 0,
            provisionalTeams: 0,
            officialRecalculated: body.officialSkipped === false,
          });
          setReloadToken((token) => token + 1);
          form.reset();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "File di emergenza rifiutato.");
        } finally {
          setPending(false);
        }
      }}
    >
      <h2>File di emergenza</h2>
      <p>
        Se la fonte voti va in timeout o risponde male, carica il JSON o il CSV ufficiale della giornata già scelta sopra.
        Una riga non valida blocca tutto il file. Dopo il salvataggio le partite di quella giornata risultano chiuse e il calcolo parte.
      </p>
      <label>
        File .json o .csv
        <input name="file" type="file" accept=".json,.csv,application/json,text/csv" required />
      </label>
      <button className="primary" type="submit" disabled={pending || !gameweekId}>
        {pending ? "Controllo il file…" : "Carica e calcola"}
      </button>
    </form>
    <article className="card">
      <LoadedVotes gameweekId={gameweekId} reloadToken={reloadToken} />
    </article>
    </div>
  );
}
