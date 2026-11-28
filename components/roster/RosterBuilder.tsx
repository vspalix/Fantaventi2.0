"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearInviteCookie, joinHref, readInviteCookie } from "@/lib/invite";
import { pushToast } from "@/lib/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { JoinImportPrompt } from "@/components/leagues/JoinImportPrompt";
import { TeamBadge } from "@/components/TeamBadge";
import { EmptyState } from "@/components/EmptyState";
import { ClubGrid } from "@/components/roster/ClubGrid";
import { ClubModal } from "@/components/roster/ClubModal";
import { RosterSidebar } from "@/components/roster/RosterSidebar";
import { useTapGuard } from "@/components/useTapGuard";
import { evaluateRoster } from "@/lib/constraints";
import { DEFAULT_RULES, ROLE_LABEL, type CatalogPlayer, type CatalogResponse, type LeagueSquad, type PlayerRole, type RosterImportSource, type RosterMarket, type RosterState } from "@/lib/types";
import { readableError } from "@/lib/feedback";
import { useShown } from "@/components/ShowMore";

const ROLE_LETTER: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };

const ROLE_ORDER: Record<PlayerRole, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

function roleMax(role: PlayerRole, rules: { gkMax: number; outfieldMax: number }) {
  return role === "GK" ? rules.gkMax : rules.outfieldMax;
}

/** Le rose degli altri, a pezzi: in una lega grande tutte insieme bloccherebbero il telefono. */
function OtherSquads({ squads }: { squads: LeagueSquad[] }) {
  const { shown, more } = useShown(squads, 20);
  return (
    <>
      {shown.map((squad) => (
        <article className="card" key={squad.fantasyTeamId}>
          <h2>{squad.teamName}</h2>
          <p className="small muted">{[squad.displayName, `${squad.players.length} calciatori`].filter(Boolean).join(" · ")}</p>
          {squad.players.length === 0 ? <p className="small muted">Rosa non ancora salvata.</p> : (
            <div>
              {(["GK", "DEF", "MID", "FWD"] as PlayerRole[]).map((role) => {
                const rows = squad.players.filter((player) => player.role === role);
                if (rows.length === 0) return null;
                return (
                  <section className="rosa-role" key={role}>
                    <h2><span className="role-chip" data-role={role} aria-hidden="true">{ROLE_LETTER[role]}</span>{ROLE_LABEL[role]}<small>{rows.length}</small></h2>
                    {rows.map((player) => (
                      <p className="rosa-line" key={player.id}><TeamBadge teamName={player.clubShort} /><strong>{player.fullName}</strong><span>{player.clubShort}</span></p>
                    ))}
                  </section>
                );
              })}
            </div>
          )}
        </article>
      ))}
      {more}
    </>
  );
}

export function RosterBuilder({
  signedIn,
  catalog,
  initialRoster,
  loadError,
  others = null,
  checkpointNote = null,
  leagueId = null,
  leagueName = "",
}: {
  signedIn: boolean;
  catalog: CatalogResponse | null;
  initialRoster: RosterState | null;
  loadError: string | null;
  others?: { leagueName: string; squads: LeagueSquad[] } | null;
  checkpointNote?: string | null;
  leagueId?: string | null;
  leagueName?: string;
}) {
  const rules = catalog?.rules ?? DEFAULT_RULES;
  const players = catalog?.players ?? [];
  const clubs = catalog?.clubs ?? [];
  const knownIds = new Set(players.map((player) => player.id));
  const [query, setQuery] = useState("");
  const [roleFocus, setRoleFocus] = useState<PlayerRole | null>(null);
  const [openClubId, setOpenClubId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState(initialRoster?.teamName || "La mia squadra");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    (initialRoster?.playerIds ?? []).filter((id) => knownIds.has(id)),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(loadError);
  const [pending, setPending] = useState(false);
  const [joinOffer, setJoinOffer] = useState<{ targetName: string; sources: RosterImportSource[] } | null>(null);
  const [othersView, setOthersView] = useState(others);
  const [othersLoading, setOthersLoading] = useState(false);
  const flight = useRef(false);
  const picks = useTapGuard();
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [mode, setMode] = useState<"rosa" | "checkpoint" | "others">("rosa");
  const [info, setInfo] = useState(false);
  const market: RosterMarket = initialRoster?.market ?? { locked: false, gameweekNumber: null, message: null };
  const [appliesFrom, setAppliesFrom] = useState(initialRoster?.appliesFrom ?? 1);
  const locked = market.locked;

  useEffect(() => {
    setInviteCode(readInviteCookie());
  }, []);

  useEffect(() => {
    // othersLoading non sta tra le dipendenze: cambiandolo qui si annullava da sola la richiesta appena partita.
    if (mode !== "others" || othersView || !leagueId) return;
    let cancelled = false;
    setOthersLoading(true);
    void fetch(`/api/leagues/${leagueId}/others?gameweek=${appliesFrom}`)
      .then(async (response) => {
        const body = await response.json() as { leagueName?: string; squads?: LeagueSquad[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Rose non disponibili.");
        if (!cancelled) setOthersView({ leagueName: body.leagueName ?? leagueName, squads: body.squads ?? [] });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(readableError(reason, "Rose non disponibili."));
      })
      .finally(() => {
        if (!cancelled) setOthersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, othersView, leagueId, appliesFrom, leagueName]);

  const selected = useMemo(
    () => selectedIds
      .map((id) => players.find((player) => player.id === id))
      .filter((player): player is CatalogPlayer => Boolean(player)),
    [players, selectedIds],
  );
  const report = evaluateRoster(selected, clubs, rules);
  const needle = query.trim().toLocaleLowerCase("it");

  const clubCards = useMemo(() => {
    return clubs.flatMap((club) => {
      const squad = players.filter((player) => player.clubId === club.id);
      const chosen = selected.find((player) => player.clubId === club.id) ?? null;
      const clubMatches = !needle || `${club.name} ${club.shortName}`.toLocaleLowerCase("it").includes(needle);
      const matchNames = needle
        ? squad.filter((player) => player.fullName.toLocaleLowerCase("it").includes(needle)).map((player) => player.fullName)
        : [];
      const roleMatches = !roleFocus || squad.some((player) => player.role === roleFocus);
      if (!roleMatches || (!clubMatches && matchNames.length === 0)) return [];
      return [{ club, chosen, matchNames: clubMatches ? [] : matchNames }];
    });
  }, [clubs, players, selected, needle, roleFocus]);

  const openClub = clubs.find((club) => club.id === openClubId) ?? null;
  const openPlayers = openClub
    ? players
        .filter((player) => {
          if (player.clubId !== openClub.id) return false;
          const chosen = selected.some((item) => item.id === player.id);
          const matchesQuery = !needle || chosen || player.fullName.toLocaleLowerCase("it").includes(needle);
          const matchesRole = !roleFocus || chosen || player.role === roleFocus;
          return matchesQuery && matchesRole;
        })
        .sort((left, right) =>
          ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
          || left.fullName.localeCompare(right.fullName, "it"),
        )
    : [];

  const closeClub = useCallback(() => setOpenClubId(null), []);

  function removePlayer(playerId: string) {
    if (locked || pending) return;
    picks.occupy(playerId, () => {
      setMessage(null);
      setSelectedIds((current) => current.filter((id) => id !== playerId));
    });
  }

  function resetRoster() {
    if (locked || pending || selectedIds.length === 0) return;
    picks.hold("reset", () => {
      const confirmed = window.confirm(
        "Svuotare tutta la rosa e ricominciare da zero? Il salvataggio resta chiuso finché ruoli e club non sono di nuovo validi.",
      );
      if (!confirmed) return;
      setSelectedIds([]);
      setOpenClubId(null);
      setMessage(null);
      setError(null);
    });
  }

  function togglePlayer(player: CatalogPlayer) {
    if (locked || pending) return;
    picks.occupy(player.id, () => {
      setMessage(null);
      setSelectedIds((current) => {
        if (current.includes(player.id)) return current.filter((id) => id !== player.id);
        const currentPlayers = current
          .map((id) => players.find((item) => item.id === id))
          .filter((item): item is CatalogPlayer => Boolean(item));
        const clubTaken = currentPlayers.some((item) => item.clubId === player.clubId);
        const roleCount = currentPlayers.filter((item) => item.role === player.role).length;
        if (clubTaken || roleCount >= roleMax(player.role, rules)) return current;
        return [...current, player.id];
      });
      setOpenClubId(null);
    });
  }

  async function save() {
    if (flight.current || picks.locked || locked || !report.ready) return;
    flight.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamName, playerIds: selected.map((player) => player.id), leagueId }),
      });
      const body = (await response.json()) as { error?: string; roster?: { appliesFrom?: number } };
      if (!response.ok) {
        const text = body.error ?? "Salvataggio rifiutato.";
        setError(text);
        pushToast("err", text);
        return;
      }
      if (body.roster?.appliesFrom) setAppliesFrom(body.roster.appliesFrom);
      const invite = readInviteCookie();
      if (invite) {
        const join = await fetch("/api/leagues/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: invite }),
        });
        const joined = (await join.json()) as {
          error?: string;
          league?: { id: string };
          needsImport?: boolean;
          targetName?: string;
          sources?: RosterImportSource[];
        };
        if (joined.needsImport && joined.targetName && joined.sources) {
          setJoinOffer({ targetName: joined.targetName, sources: joined.sources });
          pushToast("ok", "Rosa salvata. Scegli se portarla nella lega nuova.");
          return;
        }
        if (join.ok && joined.league?.id) {
          clearInviteCookie();
          pushToast("ok", "Rosa salvata. Ti sto iscrivendo alla lega.");
          window.location.assign(`/leghe/${joined.league.id}`);
          return;
        }
        const text = joined.error ?? "Rosa salvata, ma l'iscrizione alla lega non è riuscita.";
        setError(text);
        pushToast("err", text);
        return;
      }
      const saved = `Rosa salvata. I cambi valgono dalla giornata ${body.roster?.appliesFrom ?? appliesFrom}.`;
      setMessage(`${saved} Ruoli e club sono controllati.`);
      pushToast("ok", saved);
    } catch (reason) {
      const text = readableError(reason, "Salvataggio non riuscito.");
      setError(text);
      pushToast("err", text);
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  async function finishInvite(importFromLeagueId: string | null) {
    const invite = readInviteCookie();
    if (!invite || flight.current) return;
    flight.current = true;
    setPending(true);
    setError(null);
    try {
      const join = await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: invite, confirmed: true, importFromLeagueId }),
      });
      const joined = (await join.json()) as { error?: string; league?: { id: string } };
      if (!join.ok || !joined.league?.id) {
        const text = joined.error ?? "Iscrizione non riuscita.";
        setError(text);
        pushToast("err", text);
        return;
      }
      clearInviteCookie();
      window.location.assign(`/leghe/${joined.league.id}`);
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  if (!signedIn) {
    return (
      <section className="card">
        <h2>Entra per costruire la rosa</h2>
        <Link className="primary" href={inviteCode ? `/accesso?next=${encodeURIComponent(joinHref(inviteCode))}` : "/accesso"}>Vai all&apos;accesso</Link>
      </section>
    );
  }

  if (joinOffer) {
    return (
      <div className="stack">
        {error ? <p className="banner">{error}</p> : null}
        <JoinImportPrompt
          targetName={joinOffer.targetName}
          sources={joinOffer.sources}
          pending={pending}
          onPick={(importFromLeagueId) => void finishInvite(importFromLeagueId)}
        />
      </div>
    );
  }

  const head = (
    <header className="rosa-head">
      <div>
        <h1 className="section-title">{mode === "others" ? "Rose degli altri" : teamName || "Rosa"}</h1>
        {mode === "rosa" ? <p className="small muted">{leagueName ? `${leagueName} · ` : ""}{selected.length}/{rules.squadSize}</p> : null}
        {mode === "checkpoint" ? <p className="checkpoint-pill" data-on="true">Checkpoint</p> : null}
        {mode === "others" && othersView ? <p className="small muted">{othersView.leagueName}</p> : null}
      </div>
      <button className="info-button" type="button" aria-expanded={info} aria-label="Come funziona la rosa" onClick={() => setInfo((current) => !current)}>i</button>
    </header>
  );
  const infoCard = info ? (
    <p className="card rosa-info">
      Dal checkpoint apri un club e scegli un calciatore: la lista si chiude da sola. Togli sta a destra sulla tessera del club.
      Durante le partite della giornata la rosa resta ferma. Al salvataggio restano un club ciascuno e i limiti di ruolo.
      Questa rosa vale solo in questa lega.
      I cambi valgono dalla giornata {appliesFrom}.
    </p>
  ) : null;

  if (mode === "others") {
    return (
      <div className="stack">
        {head}
        {infoCard}
        <button className="ghost" type="button" onClick={() => setMode("rosa")}>Torna alla tua rosa</button>
        {othersLoading ? <p className="small muted">Carico le rose...</p> : null}
        {!othersLoading && (!othersView || othersView.squads.length === 0) ? (
          <EmptyState title="Nessun'altra rosa">
            Quando gli altri della lega salvano la rosa, la vedi da qui.
          </EmptyState>
        ) : null}
        {!othersLoading && othersView ? <OtherSquads squads={othersView.squads} /> : null}
      </div>
    );
  }

  if (mode === "rosa") {
    return (
      <div className="stack">
        {head}
        {infoCard}
        <div className="rosa-actions">
          <button className="ghost" type="button" onClick={() => setMode("checkpoint")}>Checkpoint</button>
          <button className="ghost" type="button" onClick={() => setMode("others")}>Rose degli altri</button>
        </div>
        {error ? <p className="banner">{error}</p> : null}
        {market.message ? <p className="banner">{market.message}</p> : null}
        {selected.length === 0 ? (
          <EmptyState title="Rosa ancora vuota">
            Apri Checkpoint per scegliere un calciatore per club.
          </EmptyState>
        ) : (["GK", "DEF", "MID", "FWD"] as PlayerRole[]).map((role) => {
          const rows = selected.filter((player) => player.role === role).sort((left, right) => left.fullName.localeCompare(right.fullName, "it"));
          if (rows.length === 0) return null;
          return (
            <section className="rosa-role rosa-role-card" key={role}>
              <h2><span className="role-chip" data-role={role} aria-hidden="true">{ROLE_LETTER[role]}</span>{ROLE_LABEL[role]}<small>{rows.length}</small></h2>
              {rows.map((player) => (
                <p className="rosa-line" key={player.id}><TeamBadge teamName={player.clubShort} /><strong>{player.fullName}</strong><span>{player.clubShort}</span></p>
              ))}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {head}
      {infoCard}
      <div className="row roster-toolbar">
        <button className="ghost" type="button" onClick={() => setMode("rosa")}>Torna alla rosa</button>
        <label className="team-name-field">
          Nome squadra
          <input value={teamName} onChange={(event) => setTeamName(event.target.value)} disabled={pending} />
        </label>
      </div>
      <div className="thumb-bar">
        <button className="danger" type="button" disabled={pending || picks.locked || locked || selectedIds.length === 0} aria-busy={picks.busyId === "reset"} onClick={resetRoster}>
          {picks.busyId === "reset" ? <span className="spinner" aria-hidden="true" /> : null}
          Ricomincia da zero
        </button>
        <button className="primary" type="button" disabled={pending || picks.locked || locked || !report.ready || !catalog} aria-busy={pending} onClick={() => void save()}>
          <BusyLabel pending={pending} idle="Salva rosa" busy="Salvataggio..." />
        </button>
      </div>
      {market.message ? <p className="banner">{market.message}</p> : (
        <p className="small muted">{checkpointNote ?? `I cambi valgono dalla giornata ${appliesFrom}.`}</p>
      )}
      {inviteCode ? <p className="banner ok">Hai un invito in sospeso. Salva la rosa e entri in lega senza digitare il codice.</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {message ? <p className="banner ok">{message}</p> : null}
      <div className="roster-layout">
        <section className="panel roster-main" data-pending={pending || picks.locked}>
          <div className="roster-main-head">
            <h2>Per club</h2>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca un club o un calciatore"
              aria-label="Cerca un club o un calciatore"
            />
          </div>
          <ClubGrid
            clubs={clubCards}
            locked={locked || pending}
            busyId={picks.busyId}
            onOpen={(clubId) => {
              if (locked || pending) return;
              picks.occupy(clubId, () => setOpenClubId(clubId));
            }}
            onRemove={removePlayer}
          />
        </section>
        <RosterSidebar
          report={report}
          rules={rules}
          selected={selected}
          roleFocus={roleFocus}
          onRoleFocus={setRoleFocus}
          onOpenClub={(clubId) => {
            if (locked || pending) return;
            picks.occupy(clubId, () => setOpenClubId(clubId));
          }}
        />
      </div>
      {openClub ? (
        <ClubModal
          club={openClub}
          players={openPlayers}
          chosen={selected.find((player) => player.clubId === openClub.id) ?? null}
          roleCounts={report.roles}
          rules={rules}
          locked={locked || pending}
          busyId={picks.busyId}
          onToggle={togglePlayer}
          onClose={closeClub}
        />
      ) : null}
    </div>
  );
}
