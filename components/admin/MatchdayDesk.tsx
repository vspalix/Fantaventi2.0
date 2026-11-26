"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadedVotes } from "@/components/admin/LoadedVotes";
import { BusyLabel } from "@/components/BusyLabel";
import { EmptyState } from "@/components/EmptyState";
import type { AdminFiledLineup, TestLabSnapshot } from "@/lib/admin-types";
import { pushToast } from "@/lib/toast";

type MatchHold = "none" | "postponed" | "suspended";

type MatchRow = {
  id: string;
  home: string;
  away: string;
  kickoffAt: string;
  status: string;
  postponed?: boolean;
  hold?: MatchHold;
  homeClubId?: string;
  awayClubId?: string;
  homeGoals: number | null;
  awayGoals: number | null;
};

type ScoreRow = {
  fantasyTeamId: string;
  teamName: string;
  total: number;
};

const kickoffFormat = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

function isStillOpen(week: TestLabSnapshot["gameweeks"][number], now = Date.now()) {
  const closed = week.status === "locked" || week.status === "scored" || week.status === "final";
  return !closed && new Date(week.deadlineAt).getTime() > now;
}

function openingGameweek(gameweeks: TestLabSnapshot["gameweeks"]) {
  return gameweeks.find((week) => isStillOpen(week)) ?? gameweeks[gameweeks.length - 1] ?? null;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Operazione non riuscita.");
  return body;
}

function points(value: number) {
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function holdOf(match: MatchRow): MatchHold {
  if (match.hold === "postponed" || match.hold === "suspended") return match.hold;
  return match.postponed ? "postponed" : "none";
}

function holdLabel(hold: MatchHold) {
  if (hold === "postponed") return "rinviata";
  if (hold === "suspended") return "sospesa";
  return "in calendario";
}

export function MatchdayDesk({ initial }: { initial: TestLabSnapshot }) {
  const opening = openingGameweek(initial.gameweeks);
  const [leagueId, setLeagueId] = useState(initial.leagues[0]?.id ?? "");
  const [gameweekId, setGameweekId] = useState(opening?.id ?? "");
  const [weeks, setWeeks] = useState(initial.gameweeks);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [lineups, setLineups] = useState<AdminFiledLineup[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const flight = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [votesStamp, setVotesStamp] = useState(0);

  const gameweek = weeks.find((week) => week.id === gameweekId) ?? null;
  const filed = lineups.filter((lineup) => lineup.filed).length;
  const closed = gameweek?.status === "scored" || gameweek?.status === "final";

  const orderedScores = useMemo(
    () => [...scores].sort((left, right) => right.total - left.total || left.teamName.localeCompare(right.teamName, "it")),
    [scores],
  );

  useEffect(() => {
    if (!gameweekId) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/admin/matches?gameweekId=${encodeURIComponent(gameweekId)}`)
      .then((response) => readJson<{ matches: MatchRow[] }>(response))
      .then((body) => {
        if (!cancelled) setMatches(body.matches);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [gameweekId, votesStamp]);

  useEffect(() => {
    if (!leagueId || !gameweekId) {
      setLineups([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/admin/lineups?leagueId=${encodeURIComponent(leagueId)}&gameweekId=${encodeURIComponent(gameweekId)}`)
      .then((response) => readJson<{ lineups: AdminFiledLineup[] }>(response))
      .then((body) => {
        if (!cancelled) setLineups(body.lineups);
      })
      .catch(() => {
        if (!cancelled) setLineups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, gameweekId]);

  useEffect(() => {
    if (!leagueId || !gameweekId) {
      setScores([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/admin/gameweek-scores?leagueId=${encodeURIComponent(leagueId)}&gameweekId=${encodeURIComponent(gameweekId)}`)
      .then((response) => readJson<{ scores: ScoreRow[] }>(response))
      .then((body) => {
        if (!cancelled) setScores(body.scores);
      })
      .catch(() => {
        if (!cancelled) setScores([]);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, gameweekId, votesStamp]);

  async function run(label: string, task: () => Promise<string>) {
    if (flight.current) return;
    flight.current = true;
    setPending(label);
    setError(null);
    setNotice(null);
    try {
      const text = await task();
      setNotice(text);
      pushToast("ok", text);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Operazione non riuscita.";
      setError(text);
      pushToast("err", text);
    } finally {
      flight.current = false;
      setPending(null);
    }
  }

  async function importVotes() {
    await run("Recupero i voti…", async () => {
      const response = await fetch("/api/admin/process-matchday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      });
      const body = await readJson<{
        votes: { synced: { players: number }[]; scored: number[]; errors: { message: string }[] };
      }>(response);
      setVotesStamp((stamp) => stamp + 1);
      const players = body.votes.synced.reduce((sum, match) => sum + match.players, 0);
      if (body.votes.errors.length > 0) throw new Error(body.votes.errors[0]?.message ?? "Recupero voti non riuscito.");
      if (body.votes.synced.length === 0) {
        return "Nessun voto ufficiale nuovo: il turno non è concluso, i voti non sono completi o sono già salvati.";
      }
      const scored = [...new Set(body.votes.scored)];
      return scored.length > 0
        ? `Voti recuperati per ${players} calciatori. Classifica aggiornata per le giornate ${scored.join(", ")}.`
        : `Voti recuperati per ${players} calciatori. La classifica si aggiorna quando la giornata è completa.`;
    });
  }

  async function recalculate() {
    if (flight.current || !gameweek) return;
    flight.current = true;
    setPending("Ricalcolo…");
    const confirmed = window.confirm(
      closed
        ? `Ricalcolare la giornata ${gameweek.number} già chiusa? Punteggi e classifica di questa giornata vengono riscritti.`
        : `Calcolare punteggi e classifica della giornata ${gameweek.number}?`,
    );
    if (!confirmed) {
      flight.current = false;
      setPending(null);
      return;
    }
    flight.current = false;
    await run("Ricalcolo…", async () => {
      if (closed) {
        const response = await fetch("/api/admin/match-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recalculate", gameweekId }),
        });
        const body = await readJson<{ gameweekNumber?: number; teams?: number }>(response);
        setVotesStamp((stamp) => stamp + 1);
        return `Giornata ${body.gameweekNumber ?? gameweek.number} ricalcolata: ${body.teams ?? 0} squadre in classifica.`;
      }
      const response = await fetch("/api/admin/calculate-gameweek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, gameweekId }),
      });
      const body = await readJson<{ gameweekNumber: number; teams: number; skipped?: boolean }>(response);
      setVotesStamp((stamp) => stamp + 1);
      setWeeks((current) => current.map((week) => week.id === gameweekId ? { ...week, status: "scored" } : week));
      if (body.skipped) return `Giornata ${body.gameweekNumber}: nessuna squadra nuova da calcolare.`;
      return `Giornata ${body.gameweekNumber} calcolata: ${body.teams} squadre in classifica.`;
    });
  }

  async function setHold(match: MatchRow, hold: MatchHold) {
    if (flight.current || hold === holdOf(match)) return;
    flight.current = true;
    setPending("Stato partita…");
    const confirmed = window.confirm(`Segnare ${match.home} – ${match.away} come ${holdLabel(hold)}?`);
    if (!confirmed) {
      flight.current = false;
      setPending(null);
      return;
    }
    flight.current = false;
    await run("Stato partita…", async () => {
      const response = await fetch("/api/admin/match-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hold", matchId: match.id, hold }),
      });
      const body = await readJson<{ hold: MatchHold }>(response);
      setMatches((current) => current.map((item) => item.id === match.id ? { ...item, hold: body.hold, postponed: body.hold !== "none" } : item));
      if (body.hold === "suspended") return `${match.home} – ${match.away} sospesa: i voti restano fuori finché non li confermi.`;
      if (body.hold === "postponed") return `${match.home} – ${match.away} rinviata: quei club restano fuori dal calcolo finché non si gioca.`;
      return `${match.home} – ${match.away} di nuovo in calendario. Se i voti del recupero sono già importati, lancia il ricalcolo parziale o totale.`;
    });
  }

  async function recalculatePartial(match: MatchRow) {
    if (flight.current || !gameweek || !closed) return;
    flight.current = true;
    setPending("Ricalcolo parziale…");
    const confirmed = window.confirm(
      `Ricalcolare solo le squadre che schierano un calciatore di ${match.home} o ${match.away}? Il resto della giornata ${gameweek.number} resta com'è.`,
    );
    if (!confirmed) {
      flight.current = false;
      setPending(null);
      return;
    }
    flight.current = false;
    await run("Ricalcolo parziale…", async () => {
      const response = await fetch("/api/admin/match-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recalculate-partial",
          gameweekId,
          clubIds: [match.homeClubId, match.awayClubId].filter(Boolean),
        }),
      });
      const body = await readJson<{ gameweekNumber?: number; teams?: number; skipped?: boolean; reason?: string | null }>(response);
      setVotesStamp((stamp) => stamp + 1);
      if (body.skipped) return body.reason ?? "Ricalcolo parziale non eseguito: ci sono ancora partite aperte.";
      return `Ricalcolo parziale giornata ${body.gameweekNumber ?? gameweek.number}: ${body.teams ?? 0} squadre aggiornate.`;
    });
  }

  if (initial.leagues.length === 0) {
    return (
      <EmptyState title="Serve una lega" action={<Link className="primary" href="/leghe">Vai alle leghe</Link>}>
        Crea o apri una lega. Voti, classifica, rinvii e formazioni si leggono da lì.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <section className="card stack">
        <label>
          Lega
          <select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>
            {initial.leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name} · giornate {league.startMatchday}–{league.endMatchday}
              </option>
            ))}
          </select>
        </label>
        <div className="gw-row" role="tablist" aria-label="Giornata">
          {weeks.map((week) => (
            <button
              key={week.id}
              className="gw-chip"
              type="button"
              data-active={week.id === gameweekId}
              data-locked={!isStillOpen(week)}
              onClick={() => setGameweekId(week.id)}
            >
              {week.number}
            </button>
          ))}
        </div>
        <p className="small muted">
          Giornata {gameweek?.number ?? "—"}
          {gameweek ? ` · ${gameweek.status}` : ""}.
          {filed} formazioni consegnate su {lineups.length}.
        </p>
      </section>

      {error ? <p className="banner" role="alert">{error}</p> : null}
      {notice ? <p className="banner ok" role="status">{notice}</p> : null}

      <section className="card stack" id="voti">
        <h2>Voti della giornata</h2>
        <p className="small muted">
          Legge subito la fonte: i voti diventano ufficiali dalle 08:00 successive al turno. Puoi anche caricare un file. Sotto controlli chi ha già un voto.
        </p>
        <div className="row">
          <button className="primary" type="button" disabled={pending !== null || !leagueId} aria-busy={pending !== null} onClick={() => void importVotes()}>
            <BusyLabel pending={pending === "Recupero i voti…"} idle="Recupera i voti" busy="Recupero…" />
          </button>
          <Link className="ghost" href="/admin/import-voti">Carica un file di voti</Link>
        </div>
        {gameweekId ? <LoadedVotes gameweekId={gameweekId} reloadToken={votesStamp} /> : (
          <EmptyState title="Nessuna giornata">Scegli una giornata per vedere i voti caricati.</EmptyState>
        )}
      </section>

      <section className="card stack" id="classifica">
        <h2>Punteggi e classifica</h2>
        <p className="small muted">
          {closed
            ? "Questa giornata è già chiusa. Il ricalcolo totale riscrive tutte le squadre. Il ricalcolo parziale, più sotto, tocca solo chi schiera i club del recupero."
            : "Il calcolo usa i voti caricati. Una partita rinviata o sospesa non blocca le altre: quei club restano fuori."}
        </p>
        <button className="primary" type="button" disabled={pending !== null || !leagueId || !gameweekId} aria-busy={pending !== null} onClick={() => void recalculate()}>
          <BusyLabel pending={pending === "Ricalcolo…"} idle={closed ? "Ricalcolo totale" : "Calcola punteggi e classifica"} busy="Ricalcolo…" />
        </button>
        {orderedScores.length === 0 ? (
          <EmptyState title="Classifica di giornata vuota">
            I punteggi compaiono qui dopo il calcolo. Prima servono i voti e le partite chiuse.
          </EmptyState>
        ) : (
          <table className="standings as-cards">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Squadra</th>
                <th>Punti</th>
              </tr>
            </thead>
            <tbody>
              {orderedScores.map((row, index) => (
                <tr key={row.fantasyTeamId}>
                  <td data-label="Pos">{index + 1}</td>
                  <td data-label="Squadra">{row.teamName}</td>
                  <td data-label="Punti">{points(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card stack" id="rinvii">
        <h2>Rinviate e sospese</h2>
        <p className="small muted">
          Rinviata: la partita non si è giocata. Sospesa: i voti sono sub iudice. In entrambi i casi quei club non entrano nel calcolo.
          Se il regolamento della lega prevede il 6 politico, lo prende chi li schiera; altrimenti restano fuori finché non rimetti la partita in calendario.
          Quando i voti veri del recupero sono importati, un click ricalcola solo quelle squadre oppure tutta la giornata.
        </p>
        {matches.length === 0 ? (
          <EmptyState title="Nessuna partita">
            Questa giornata non ha incontri in calendario. Importa il calendario dal collaudo, poi torna qui.
          </EmptyState>
        ) : (
          <ul className="list">
            {matches.map((match) => (
              <li className="person" key={match.id}>
                <span className="person-main">
                  <strong>{match.home} – {match.away}</strong>
                  <span className="small muted">
                    {kickoffFormat.format(new Date(match.kickoffAt))}
                    {match.homeGoals != null && match.awayGoals != null ? ` · ${match.homeGoals}-${match.awayGoals}` : ""}
                    {holdOf(match) === "postponed" ? " · rinviata" : ""}
                    {holdOf(match) === "suspended" ? " · sospesa" : ""}
                  </span>
                </span>
                <label className="small">
                  Stato
                  <select
                    value={holdOf(match)}
                    disabled={pending !== null}
                    onChange={(event) => void setHold(match, event.target.value as MatchHold)}
                  >
                    <option value="none">In calendario</option>
                    <option value="postponed">Rinviata</option>
                    <option value="suspended">Sospesa</option>
                  </select>
                </label>
                {closed && holdOf(match) === "none" ? (
                  <button className="ghost" type="button" disabled={pending !== null} onClick={() => void recalculatePartial(match)}>
                    <BusyLabel pending={pending === "Ricalcolo parziale…"} idle="Ricalcolo parziale" busy="Ricalcolo…" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack" id="formazioni">
        <h2>Formazioni consegnate</h2>
        <p className="small muted">{filed} su {lineups.length} squadre hanno salvato la formazione di questa giornata.</p>
        {lineups.length === 0 ? (
          <EmptyState title="Nessuna squadra">
            In questa lega non c&apos;è ancora nessuno da controllare.
          </EmptyState>
        ) : (
          <table className="standings as-cards">
            <thead>
              <tr>
                <th>Squadra</th>
                <th>Stato</th>
                <th>Ora</th>
              </tr>
            </thead>
            <tbody>
              {[...lineups].sort((left, right) => Number(right.filed) - Number(left.filed) || left.teamName.localeCompare(right.teamName, "it")).map((lineup) => (
                <tr key={lineup.fantasyTeamId}>
                  <td data-label="Squadra">
                    <strong>{lineup.teamName}</strong>
                    <span className="small muted"> · {lineup.displayName}</span>
                  </td>
                  <td data-label="Stato">{lineup.filed ? "Consegnata" : "Mancante"}</td>
                  <td data-label="Ora">{lineup.filed && lineup.savedAt ? kickoffFormat.format(new Date(lineup.savedAt)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
