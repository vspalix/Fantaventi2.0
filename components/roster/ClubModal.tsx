"use client";

import { useEffect, useRef } from "react";
import type { CatalogPlayer, ClubRef, PlayerRole, RosterRules } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";

function roleMax(role: PlayerRole, rules: RosterRules) {
  return role === "GK" ? rules.gkMax : rules.outfieldMax;
}

export function ClubModal({
  club,
  players,
  chosen,
  roleCounts,
  rules,
  locked,
  onToggle,
  onClose,
}: {
  club: ClubRef;
  players: CatalogPlayer[];
  chosen: CatalogPlayer | null;
  roleCounts: Record<PlayerRole, number>;
  rules: RosterRules;
  locked: boolean;
  onToggle: (player: CatalogPlayer) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="club-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <p className="small muted">{club.shortName}</p>
            <h2 id="club-modal-title">{club.name}</h2>
          </div>
          <button ref={closeRef} className="ghost" type="button" onClick={onClose}>
            Chiudi
          </button>
        </header>
        {chosen ? (
          <p className="small muted">Club coperto da {chosen.fullName}. Toglilo per sceglierne un altro.</p>
        ) : (
          <p className="small muted">Un solo calciatore di questo club può entrare in rosa.</p>
        )}
        <div className="catalog">
          {players.length === 0 ? <p className="muted">Nessun calciatore con questa ricerca.</p> : null}
          {players.map((player) => {
            const selected = chosen?.id === player.id;
            const blockedByClub = Boolean(chosen) && !selected;
            const blockedByRole = !selected && roleCounts[player.role] >= roleMax(player.role, rules);
            const blocked = locked || blockedByClub || blockedByRole;
            const reason = locked
              ? "Giornata in corso"
              : blockedByClub
                ? "Club coperto"
                : blockedByRole
                  ? `${ROLE_LABEL[player.role]} al completo`
                  : null;
            return (
              <button
                key={player.id}
                type="button"
                className="player player-choice"
                data-blocked={blocked}
                disabled={blocked}
                onClick={() => onToggle(player)}
              >
                <span className="player-main">
                  <strong>
                    {player.fullName}
                  </strong>
                  <span className="small muted">{reason ?? ROLE_LABEL[player.role]}</span>
                </span>
                <span className="row">
                  <span className={`badge ${player.role}`}>{player.role}</span>
                  <span className="small">{selected ? "Togli" : "Scegli"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
