import type { CatalogPlayer } from "@/lib/types";

export function AvailabilityBadge({ player }: { player: CatalogPlayer }) {
  const mark = player.availability;
  if (!mark) return null;
  const kind = mark.status === "suspended" || mark.status === "injured" || mark.status === "doubt" ? mark.status : null;
  const probability = mark.playProbability;
  if (!kind && probability == null) return null;
  return (
    <span className="avail">
      {kind === "suspended" ? <b data-kind="suspended">SQU</b> : null}
      {kind === "injured" ? <b data-kind="injured">INF</b> : null}
      {kind === "doubt" && probability == null ? <b data-kind="doubt">DUB</b> : null}
      {probability != null ? <em data-hot={probability >= 70 ? "high" : "low"}>{probability}%</em> : null}
    </span>
  );
}

export function isUnavailable(player: CatalogPlayer) {
  return player.availability?.status === "injured" || player.availability?.status === "suspended";
}
