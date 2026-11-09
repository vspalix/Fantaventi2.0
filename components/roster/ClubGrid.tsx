import type { CatalogPlayer, ClubRef } from "@/lib/types";

export type ClubCard = {
  club: ClubRef;
  chosen: CatalogPlayer | null;
  matchNames: string[];
};

export function ClubGrid({
  clubs,
  locked,
  onOpen,
  onRemove,
}: {
  clubs: ClubCard[];
  locked: boolean;
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
        >
          <button type="button" className="club-tile-open" onClick={() => onOpen(club.id)}>
            <span className="club-tile-code">{club.shortName}</span>
            <strong>{club.name}</strong>
            {chosen ? (
              <span className="club-tile-player">{chosen.fullName}</span>
            ) : (
              <span className="club-tile-empty">Scegli un calciatore</span>
            )}
            {matchNames.length > 0 ? <span className="club-tile-match">{matchNames[0]}</span> : null}
          </button>
          {chosen ? (
            <button type="button" className="togli" disabled={locked} onClick={() => onRemove(chosen.id)}>
              Togli
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
