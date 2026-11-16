import { TeamBadge } from "@/components/TeamBadge";
import type { CatalogPlayer, ClubRef } from "@/lib/types";

export type ClubCard = {
  club: ClubRef;
  chosen: CatalogPlayer | null;
  matchNames: string[];
};

export function ClubGrid({
  clubs,
  locked,
  busyId,
  onOpen,
  onRemove,
}: {
  clubs: ClubCard[];
  locked: boolean;
  busyId: string | null;
  onOpen: (clubId: string) => void;
  onRemove: (playerId: string) => void;
}) {
  if (clubs.length === 0) {
    return <p className="muted">Nessun club corrisponde alla ricerca.</p>;
  }

  return (
    <div className="club-grid">
      {clubs.map(({ club, chosen, matchNames }) => (
        <article
          key={club.id}
          className="club-tile"
          data-covered={Boolean(chosen)}
          data-busy={busyId === club.id}
        >
          <button type="button" className="club-tile-open" disabled={locked || busyId !== null} aria-busy={busyId === club.id} onClick={() => onOpen(club.id)}>
            <span className="club-tile-code">{busyId === club.id ? <span className="spinner" aria-hidden="true" /> : null}<TeamBadge teamName={club.shortName} /> {club.shortName}</span>
            <strong>{club.name}</strong>
            {chosen ? (
              <span className="club-tile-player">{chosen.fullName}</span>
            ) : (
              <span className="club-tile-empty">Scegli un calciatore</span>
            )}
            {matchNames.length > 0 ? <span className="club-tile-match">{matchNames[0]}</span> : null}
          </button>
          {chosen ? (
            <button type="button" className="togli" disabled={locked || busyId !== null} aria-busy={busyId === chosen.id} onClick={() => onRemove(chosen.id)}>
              {busyId === chosen.id ? <span className="spinner" aria-hidden="true" /> : null}
              Togli
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
