"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearInviteCookie, joinHref, readInviteCookie } from "@/lib/invite";
import { pushToast } from "@/lib/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { EmptyState } from "@/components/EmptyState";
import { ClubGrid } from "@/components/roster/ClubGrid";
import { ClubModal } from "@/components/roster/ClubModal";
import { RosterSidebar } from "@/components/roster/RosterSidebar";
import { useTapGuard } from "@/components/useTapGuard";
import { evaluateRoster } from "@/lib/constraints";
import type { CatalogPlayer, CatalogResponse, PlayerRole, RosterMarket, RosterState } from "@/lib/types";

const ROLE_ORDER: Record<PlayerRole, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
import { DEFAULT_RULES } from "@/lib/types";

function roleMax(role: PlayerRole, rules: { gkMax: number; outfieldMax: number }) {
  return role === "GK" ? rules.gkMax : rules.outfieldMax;
}

export function RosterBuilder({
  signedIn,
  catalog,
  initialRoster,
  loadError,
}: {
  signedIn: boolean;
  catalog: CatalogResponse | null;
  initialRoster: RosterState | null;
  loadError: string | null;
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
  const flight = useRef(false);
  const picks = useTapGuard();
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const market: RosterMarket = initialRoster?.market ?? { locked: false, gameweekNumber: null, message: null };
  const [appliesFrom, setAppliesFrom] = useState(initialRoster?.appliesFrom ?? 1);
  const locked = market.locked;

  useEffect(() => {
    setInviteCode(readInviteCookie());
  }, []);

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
        body: JSON.stringify({ teamName, playerIds: selected.map((player) => player.id) }),
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
        const joined = (await join.json()) as { error?: string; league?: { id: string } };
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
      const text = reason instanceof Error ? reason.message : "Salvataggio non riuscito.";
      setError(text);
      pushToast("err", text);
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

  return (
    <div>
      <div className="row roster-toolbar">
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
        <p className="small muted">Nessun credito: un solo calciatore per club, dentro i limiti di ruolo. Fuori dalle partite i cambi valgono dalla giornata {appliesFrom}.</p>
      )}
      {selected.length === 0 ? (
        <EmptyState title="Rosa ancora vuota">
          Apri un club e scegli un calciatore. Vale un giocatore per club, dentro i limiti di ruolo. Quando la rosa è completa, premi Salva rosa.
        </EmptyState>
      ) : null}
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
