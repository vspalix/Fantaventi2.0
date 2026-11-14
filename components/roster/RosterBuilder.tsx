"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ClubGrid } from "@/components/roster/ClubGrid";
import { ClubModal } from "@/components/roster/ClubModal";
import { RosterSidebar } from "@/components/roster/RosterSidebar";
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
  const market: RosterMarket = initialRoster?.market ?? { locked: false, gameweekNumber: null, message: null };
  const [appliesFrom, setAppliesFrom] = useState(initialRoster?.appliesFrom ?? 1);
  const locked = market.locked;

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
    if (locked) return;
    setMessage(null);
    setSelectedIds(selectedIds.filter((id) => id !== playerId));
  }

  function resetRoster() {
    if (locked || selectedIds.length === 0) return;
    const confirmed = window.confirm(
      "Svuotare tutta la rosa e ricominciare da zero? Il salvataggio resta chiuso finché ruoli e club non sono di nuovo validi.",
    );
    if (!confirmed) return;
    setSelectedIds([]);
    setOpenClubId(null);
    setMessage(null);
    setError(null);
  }

  function togglePlayer(player: CatalogPlayer) {
    if (locked) return;
    setMessage(null);

    if (selectedIds.includes(player.id)) {
      setSelectedIds(selectedIds.filter((id) => id !== player.id));
      setOpenClubId(null);
      return;
    }

    const clubTaken = selected.some((item) => item.clubId === player.clubId);
    const roleCount = selected.filter((item) => item.role === player.role).length;
    if (clubTaken || roleCount >= roleMax(player.role, rules)) {
      return;
    }

    setSelectedIds([...selectedIds, player.id]);
    setOpenClubId(null);
  }

  async function save() {
    if (locked || !report.ready) return;
    setPending(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamName, playerIds: selected.map((player) => player.id) }),
    });
    const body = (await response.json()) as { error?: string; roster?: { appliesFrom?: number } };
    setPending(false);
    if (!response.ok) {
      setError(body.error ?? "Salvataggio rifiutato.");
      return;
    }
    if (body.roster?.appliesFrom) setAppliesFrom(body.roster.appliesFrom);
    setMessage(`Rosa salvata. I cambi valgono dalla giornata ${body.roster?.appliesFrom ?? appliesFrom}. Ruoli e club sono controllati.`);
  }

  if (!signedIn) {
    return (
      <section className="card">
        <h2>Entra per costruire la rosa</h2>
        <Link className="primary" href="/accesso">Vai all&apos;accesso</Link>
      </section>
    );
  }

  return (
    <div>
      <div className="row roster-toolbar">
        <label className="team-name-field">
          Nome squadra
          <input value={teamName} onChange={(event) => setTeamName(event.target.value)} />
        </label>
        <button className="danger" type="button" disabled={pending || locked || selectedIds.length === 0} onClick={resetRoster}>
          Ricomincia da zero
        </button>
        <button className="primary" type="button" disabled={pending || locked || !report.ready || !catalog} onClick={() => void save()}>
          {pending ? "Validazione..." : "Salva rosa"}
        </button>
      </div>
      {market.message ? <p className="banner">{market.message}</p> : (
        <p className="small muted">Nessun credito: un solo calciatore per club, dentro i limiti di ruolo. Fuori dalle partite i cambi valgono dalla giornata {appliesFrom}.</p>
      )}
      {error ? <p className="banner">{error}</p> : null}
      {message ? <p className="banner ok">{message}</p> : null}
      <div className="roster-layout">
        <section className="panel roster-main">
          <div className="roster-main-head">
            <h2>Per club</h2>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca un club o un calciatore"
              aria-label="Cerca un club o un calciatore"
            />
          </div>
          <ClubGrid clubs={clubCards} locked={locked} onOpen={setOpenClubId} onRemove={removePlayer} />
        </section>
        <RosterSidebar
          report={report}
          rules={rules}
          selected={selected}
          roleFocus={roleFocus}
          onRoleFocus={setRoleFocus}
          onOpenClub={setOpenClubId}
        />
      </div>
      {openClub ? (
        <ClubModal
          club={openClub}
          players={openPlayers}
          chosen={selected.find((player) => player.clubId === openClub.id) ?? null}
          roleCounts={report.roles}
          rules={rules}
          locked={locked}
          onToggle={togglePlayer}
          onClose={closeClub}
        />
      ) : null}
    </div>
  );
}
