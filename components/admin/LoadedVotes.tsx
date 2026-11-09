"use client";

import { useEffect, useMemo, useState } from "react";
import type { LoadedVoteFile, LoadedVoteMatch, LoadedVoteRow } from "@/lib/server/loaded-votes";
import type { PlayerRole } from "@/lib/types";

type Sheet = {
  gameweekNumber: number;
  files: LoadedVoteFile[];
  votes: LoadedVoteRow[];
  matches: LoadedVoteMatch[];
  rated: number;
};

type WeekOption = { id: string; number: number; status: string; seasonId: string };

const ROLE_SHORT: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };

function sourceLabel(source: string) {
  if (source === "mock") return "Voti di test";
  return source;
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function cell(value: number) {
  return value === 0 ? "" : String(value);
}

export function LoadedVotes({ gameweekId, reloadToken = 0 }: { gameweekId: string; reloadToken?: number }) {
  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [selectedId, setSelectedId] = useState(gameweekId);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [club, setClub] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setSelectedId(gameweekId);
  }, [gameweekId]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/import-options")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Giornate non disponibili.");
        if (!cancelled) setWeeks((body.gameweeks ?? []) as WeekOption[]);
      })
      .catch(() => {
        if (!cancelled) setWeeks([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSheet(null);
      return;
    }
    let cancelled = false;
    setPending(true);
    setError(null);
    setOpenId(null);
    setClub("");
    void fetch(`/api/admin/loaded-votes?gameweekId=${encodeURIComponent(selectedId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Voti non disponibili.");
        if (!cancelled) setSheet(body as Sheet);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setSheet(null);
          setError(cause instanceof Error ? cause.message : "Voti non disponibili.");
        }
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, reloadToken]);

  const seasonId = weeks.find((week) => week.id === selectedId)?.seasonId
    ?? weeks.find((week) => week.id === gameweekId)?.seasonId
    ?? "";
  const choices = weeks
    .filter((week) => !seasonId || week.seasonId === seasonId)
    .sort((left, right) => left.number - right.number);

  const openVotes = useMemo(() => {
    if (!sheet || !openId) return [];
    const rows = openId === "all" ? sheet.votes : sheet.votes.filter((vote) => vote.importId === openId);
    return club ? rows.filter((vote) => vote.club === club) : rows;
  }, [sheet, openId, club]);

  const clubs = useMemo(() => {
    const names = new Set((sheet?.votes ?? []).map((vote) => vote.club));
    return [...names].sort((left, right) => left.localeCompare(right, "it"));
  }, [sheet]);

  if (!gameweekId && choices.length === 0) return null;

  return (
    <section className="stack vote-sheet">
      <div className="row">
        <h3>File dei voti</h3>
        <label>
          Giornata
          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {choices.map((week) => (
              <option key={week.id} value={week.id}>
                Giornata {week.number}
              </option>
            ))}
          </select>
        </label>
        {pending ? <span className="small muted">Leggo i voti caricati…</span> : null}
      </div>
      <p className="small muted">
        Accanto a ogni squadra c’è quanti suoi calciatori hanno un voto salvato in questa giornata, contati una volta.
        Le altre giornate non entrano nel numero. Il segno verde indica che almeno uno di quei voti c’è.
      </p>
      {error ? <p className="banner">{error}</p> : null}
      {sheet ? (
        <>
          <div className="vote-matches">
            {sheet.matches.length === 0 ? (
              <p className="small muted">Nessuna partita in calendario per questa giornata.</p>
            ) : sheet.matches.map((match) => (
              <p key={match.id} className="vote-match">
                <span className="vote-tick" data-on={match.votesLoaded}>{match.votesLoaded ? "✓" : ""}</span>
                <strong>{match.home}</strong>
                <span className="muted">–</span>
                <strong>{match.away}</strong>
                <span className="small muted">
                  {match.votesLoaded
                    ? `${match.home} ${match.homeVotes} voti, ${match.away} ${match.awayVotes} voti, solo questa giornata`
                    : "nessun voto caricato in questa giornata"}
                </span>
              </p>
            ))}
          </div>
          <p className="small">
            {sheet.files.length === 0
              ? "Nessun file caricato per questa giornata."
              : `${sheet.files.length} file · ${sheet.rated} voti scritti.`}
          </p>
          {sheet.files.length === 0 ? null : (
            <ul className="list">
              {sheet.files.map((file) => (
                <li key={file.id} className="person">
                  <span>
                    <strong>{file.fileName}</strong>
                    <span className="small muted">
                      {" "}· {sourceLabel(file.source)} · {formatWhen(file.importedAt)} · {file.rated} voti
                    </span>
                  </span>
                  <button
                    className="ghost"
                    type="button"
                    data-active={openId === file.id}
                    onClick={() => setOpenId(openId === file.id ? null : file.id)}
                  >
                    {openId === file.id ? "Chiudi tabella" : "Apri tabella"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sheet.votes.length > 0 ? (
            <div className="row">
              <button
                className="ghost"
                type="button"
                data-active={openId === "all"}
                onClick={() => setOpenId(openId === "all" ? null : "all")}
              >
                {openId === "all" ? "Chiudi tutti i voti" : "Apri tutti i voti della giornata"}
              </button>
              {openId ? (
                <label>
                  Squadra
                  <select value={club} onChange={(event) => setClub(event.target.value)}>
                    <option value="">Tutte</option>
                    {clubs.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          {openId ? (
            <div className="sheet-scroll">
              <table className="standings">
                <thead>
                  <tr>
                    <th>Squadra</th>
                    <th>Ruolo</th>
                    <th>Calciatore</th>
                    <th>Voto</th>
                    <th>Gol</th>
                    <th>Assist</th>
                    <th>Gialli</th>
                    <th>Rossi</th>
                    <th>Rig +</th>
                    <th>Rig −</th>
                    <th>Rig par</th>
                    <th>Aut</th>
                    <th>Sub</th>
                  </tr>
                </thead>
                <tbody>
                  {openVotes.length === 0 ? (
                    <tr><td colSpan={13}>Nessun voto con questo filtro.</td></tr>
                  ) : openVotes.map((vote) => (
                    <tr key={vote.playerId}>
                      <td>{vote.club}</td>
                      <td>{ROLE_SHORT[vote.role]}</td>
                      <td>
                        {vote.playerName}
                        {vote.postponed ? <span className="small muted"> · rinviato</span> : null}
                      </td>
                      <td>{vote.voto === null ? "—" : vote.voto.toFixed(1)}</td>
                      <td>{cell(vote.goals)}</td>
                      <td>{cell(vote.assists)}</td>
                      <td>{cell(vote.yellowCards)}</td>
                      <td>{cell(vote.redCards)}</td>
                      <td>{cell(vote.penaltiesScored)}</td>
                      <td>{cell(vote.penaltiesMissed)}</td>
                      <td>{cell(vote.penaltiesSaved)}</td>
                      <td>{cell(vote.ownGoals)}</td>
                      <td>{cell(vote.goalsConceded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
