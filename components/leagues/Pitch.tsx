import type { Formation } from "@/lib/formations";
import { roleCap } from "@/lib/formations";
import type { PlayerRole } from "@/lib/types";

export type PitchPlayer = {
  id: string;
  fullName: string;
  role: PlayerRole;
  clubShort: string;
};

const ROWS: PlayerRole[] = ["FWD", "MID", "DEF", "GK"];

function shirtName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fullName;
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^[A-Za-zÀ-ÿ]{1,2}\.$/.test(last)) return parts.slice(0, -1).join(" ");
  return last;
}

export function Pitch({
  formation,
  players,
  playerIds,
  captainId,
  viceId,
  editable,
  compact = false,
  onReplace,
  onMark,
  onPickRole,
}: {
  formation: Formation;
  players: PitchPlayer[];
  playerIds: string[];
  captainId: string | null;
  viceId: string | null;
  editable: boolean;
  compact?: boolean;
  onReplace?: (playerId: string) => void;
  onMark?: (playerId: string, kind: "captain" | "vice") => void;
  onPickRole?: (role: PlayerRole) => void;
}) {
  const byId = new Map(players.map((player) => [player.id, player]));
  return (
    <div className={compact ? "pitch compact" : "pitch"} aria-label={`Campo modulo ${formation.id}`}>
      <div className="pitch-markings" aria-hidden="true">
        <span className="pitch-halfway" />
        <span className="pitch-center" />
        <span className="pitch-box top" />
        <span className="pitch-box bottom" />
      </div>
      <p className="pitch-module">{formation.id}</p>
      <div className="pitch-rows">
        {ROWS.map((role) => {
          const cap = roleCap(formation, role);
          const placed = playerIds
            .map((playerId) => byId.get(playerId))
            .filter((player): player is PitchPlayer => Boolean(player && player.role === role))
            .slice(0, cap);
          const empties = Math.max(0, cap - placed.length);
          return (
            <div className="pitch-row" key={role}>
              {placed.map((player) => (
                <div className={`shirt ${role}`} key={player.id}>
                  <button
                    className="shirt-name"
                    type="button"
                    disabled={!editable}
                    title={editable ? "Sostituisci" : player.fullName}
                    onClick={() => onReplace?.(player.id)}
                  >
                    <strong>{shirtName(player.fullName)}</strong>
                    <span>{player.clubShort}</span>
                  </button>
                  {editable && onMark ? (
                    <span className="shirt-actions">
                      <button className="chip" type="button" data-active={captainId === player.id} onClick={() => onMark(player.id, "captain")}>C</button>
                      <button
                        className="chip"
                        type="button"
                        data-active={viceId === player.id}
                        disabled={playerIds.length < 2}
                        onClick={() => onMark(player.id, "vice")}
                      >
                        V
                      </button>
                    </span>
                  ) : (
                    <span className="shirt-flags">
                      {captainId === player.id ? "C" : ""}
                      {viceId === player.id ? "V" : ""}
                    </span>
                  )}
                </div>
              ))}
              {Array.from({ length: empties }, (_, index) => {
                const letter = role === "GK" ? "P" : role === "DEF" ? "D" : role === "MID" ? "C" : "A";
                return (
                  <button
                    className="shirt-empty"
                    key={`${role}-${index}`}
                    type="button"
                    disabled={!editable}
                    title={editable ? "Apri i giocatori di questo ruolo" : letter}
                    onClick={() => onPickRole?.(role)}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
