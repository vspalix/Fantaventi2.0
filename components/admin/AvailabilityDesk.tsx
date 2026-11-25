"use client";

import { useEffect, useState } from "react";

type Settings = {
  provider: "api-football" | "fantacalcio" | "external-json" | "manual";
  leagueId: number;
  season: number;
  jsonUrl: string;
  lastSyncAt: string | null;
  lastSyncNote: string | null;
  unmatched: { name: string; club: string; status?: string; reason: string | null }[];
  aliases: { name: string; club: string; playerId: string }[];
};

type Found = { id: string; fullName: string; club: string };

export function AvailabilityDesk() {
  const [ready, setReady] = useState(true);
  const [provider, setProvider] = useState<Settings["provider"]>("api-football");
  const [leagueId, setLeagueId] = useState(135);
  const [season, setSeason] = useState(2026);
  const [jsonUrl, setJsonUrl] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<Settings["unmatched"]>([]);
  const [aliases, setAliases] = useState<Settings["aliases"]>([]);
  const [aliasNames, setAliasNames] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [status, setStatus] = useState("injured");
  const [probability, setProbability] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function apply(settings: Settings) {
    setProvider(settings.provider);
    setLeagueId(settings.leagueId);
    setSeason(settings.season);
    setJsonUrl(settings.jsonUrl);
    setLastSyncAt(settings.lastSyncAt);
    setNote(settings.lastSyncNote);
    setUnmatched(settings.unmatched);
    setAliases(settings.aliases ?? []);
  }

  useEffect(() => {
    void fetch("/api/admin/availability")
      .then(async (response) => {
        const body = await response.json() as { settings?: Settings; ready?: boolean; aliasNames?: Record<string, string>; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Pannello non disponibile.");
        setReady(body.ready !== false);
        if (body.aliasNames) setAliasNames(body.aliasNames);
        if (body.settings) apply(body.settings);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Pannello non disponibile."));
  }, []);

  async function saveSettings() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "settings", provider, leagueId, season, jsonUrl }),
      });
      const body = await response.json() as { settings?: Settings; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      if (body.settings) apply(body.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const body = await response.json() as { reason?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Sync non riuscito.");
      setNote(body.reason ?? "Fatto.");
      const fresh = await fetch("/api/admin/availability");
      const loaded = await fresh.json() as { settings?: Settings; aliasNames?: Record<string, string> };
      if (loaded.aliasNames) setAliasNames(loaded.aliasNames);
      if (loaded.settings) apply(loaded.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function lookUp(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setFound([]);
      return;
    }
    const response = await fetch(`/api/admin/availability?q=${encodeURIComponent(value)}`);
    const body = await response.json() as { players?: Found[] };
    setFound(body.players ?? []);
  }

  async function saveManual() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manual",
          playerId: picked.id,
          status,
          playProbability: probability === "" ? null : Number(probability),
          reason,
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Salvataggio non riuscito.");
      setNote(`Stato manuale salvato per ${picked.fullName}. Il sync non lo sovrascrive.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function associate(item: Settings["unmatched"][number], player: Found) {
    const response = await fetch("/api/admin/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "alias", name: item.name, club: item.club, playerId: player.id }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Alias non salvato.");
      return;
    }
    setUnmatched((list) => list.filter((row) => row !== item));
    setAliases((list) => [...list.filter((alias) => !(alias.name === item.name && alias.club === item.club)), { name: item.name, club: item.club, playerId: player.id }]);
    setAliasNames((names) => ({ ...names, [player.id]: player.fullName }));
    setNote(`${item.name} resta abbinato a ${player.fullName} anche nelle giornate successive. Il prossimo sync lo scrive da solo.`);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const rows = file.name.endsWith(".json") ? JSON.parse(text) as unknown[] : text.split(/\r?\n/).slice(1).flatMap((line) => {
      const [name, club, status, probability, reason] = line.split(",").map((part) => part.trim());
      if (!name || !club || !status) return [];
      return [{ name, club, status, playProbability: probability ? Number(probability) : null, reason: reason || null }];
    });
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upload", rows }),
      });
      const body = await response.json() as { written?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Caricamento non riuscito.");
      setNote(`Caricati ${body.written ?? 0} stati manuali sulla giornata aperta.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Caricamento non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  const when = lastSyncAt ? new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(lastSyncAt)) : "mai";

  return (
    <div className="stack">
      {!ready ? <p className="banner">Esegui player_availability.sql nell&apos;editor SQL.</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {note ? <p className="banner ok">{note}</p> : null}
      <section className="card stack">
        <h2>Fonte dati</h2>
        <label>
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value as Settings["provider"])}>
            <option value="fantacalcio">Fantacalcio indisponibili</option>
            <option value="api-football">API-Football</option>
            <option value="external-json">URL JSON custom</option>
            <option value="manual">Solo manuale</option>
          </select>
        </label>
        <div className="row">
          <label>League ID<input type="number" value={leagueId} onChange={(event) => setLeagueId(Number(event.target.value))} /></label>
          <label>Stagione<input type="number" value={season} onChange={(event) => setSeason(Number(event.target.value))} /></label>
        </div>
        {provider === "external-json" ? <label>URL JSON<input type="url" value={jsonUrl} onChange={(event) => setJsonUrl(event.target.value)} /></label> : null}
        <p className="small muted">Ultimo sync: {when}</p>
        <div className="row">
          <button className="ghost" type="button" disabled={busy} onClick={() => void saveSettings()}>Salva fonte</button>
          <button className="primary" type="button" disabled={busy} onClick={() => void syncNow()}>Sincronizza ora</button>
        </div>
      </section>
      <section className="card stack">
        <h2>Non abbinati</h2>
        {unmatched.length === 0 ? <p>Nessuno.</p> : unmatched.map((item) => (
          <Unmatched key={`${item.name}-${item.club}`} item={item} onPick={(player) => void associate(item, player)} />
        ))}
      </section>
      <section className="card stack">
        <h2>Alias salvati</h2>
        <p className="small muted">Restano nel database e valgono a ogni sync, su ogni giornata, finché quel calciatore è nel listone.</p>
        {aliases.length === 0 ? <p>Nessuno.</p> : aliases.map((alias) => (
          <p key={`${alias.name}-${alias.club}-${alias.playerId}`}>{alias.name} · {alias.club} → {aliasNames[alias.playerId] ?? "calciatore collegato"}</p>
        ))}
      </section>
      <section className="card stack">
        <h2>Stato manuale</h2>
        <label>Cerca<input value={query} onChange={(event) => void lookUp(event.target.value)} /></label>
        {found.map((player) => (
          <button className="ghost" type="button" key={player.id} onClick={() => setPicked(player)}>{player.fullName} · {player.club}</button>
        ))}
        {picked ? <p>Selezionato: {picked.fullName}</p> : null}
        <label>
          Stato
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="suspended">Squalificato</option>
            <option value="injured">Infortunato</option>
            <option value="doubt">In dubbio</option>
            <option value="starter">Titolare</option>
            <option value="bench">Panchina</option>
            <option value="available">Disponibile</option>
          </select>
        </label>
        <label>% titolarità<input type="number" min={0} max={100} value={probability} onChange={(event) => setProbability(event.target.value)} /></label>
        <label>Motivo<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="primary" type="button" disabled={busy || !picked} onClick={() => void saveManual()}>Salva stato</button>
        <label>
          CSV o JSON
          <input type="file" accept=".csv,.json,application/json,text/csv" onChange={(event) => void onFile(event.target.files?.[0])} />
        </label>
        <p className="small muted">CSV: nome,club,stato,percentuale,motivo. Lo stato manuale non viene sovrascritto dal sync.</p>
      </section>
    </div>
  );
}

function statusLabel(status: string | undefined) {
  if (status === "suspended") return "squalificato";
  if (status === "injured") return "infortunato";
  if (status === "doubt") return "dubbio";
  return status || "";
}

function Unmatched({ item, onPick }: { item: { name: string; club: string; status?: string; reason: string | null }; onPick: (player: Found) => void }) {
  const [found, setFound] = useState<Found[]>([]);
  return (
    <div className="stack">
      <strong>{item.name} · {item.club}{item.status ? ` · ${statusLabel(item.status)}` : ""}</strong>
      <input placeholder="Cerca nel listone" onChange={(event) => {
        const value = event.target.value;
        if (value.trim().length < 2) return;
        void fetch(`/api/admin/availability?q=${encodeURIComponent(value)}`)
          .then(async (response) => setFound(((await response.json()) as { players?: Found[] }).players ?? []));
      }} />
      {found.map((player) => (
        <button className="ghost" key={player.id} type="button" onClick={() => onPick(player)}>{player.fullName}</button>
      ))}
    </div>
  );
}
