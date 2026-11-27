import { TeamBadge } from "@/components/TeamBadge";
import { ScoreIcon, type ScoreIconKind } from "@/components/scores/ScoreIcons";
import type { AuditLine, AuditPlayer, ScoreAudit } from "@/lib/engine/score-audit";
import type { PlayerRole } from "@/lib/types";

const ROLE: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };
const ROLE_ORDER: Record<PlayerRole, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

function number(value: number | null, empty = "S.V.") {
  if (value == null) return empty;
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** Un bonus o un malus: «+3», «−0,5», «0». */
function signed(value: number) {
  const text = Math.abs(value).toLocaleString("it-IT", { maximumFractionDigits: 2 });
  if (value === 0) return "0";
  return value > 0 ? `+${text}` : `−${text}`;
}

/** Le spiegazioni del calcolo usano il punto per i decimali: qui diventa la virgola. */
function italian(text: string) {
  return text.replace(/(\d)\.(\d)/g, "$1,$2");
}

function emptyNote(count: number, unit: number) {
  const value = unit.toLocaleString("it-IT", { maximumFractionDigits: 2 });
  return count === 1 ? `1 posto vuoto: vale ${value} punti.` : `${count} posti vuoti: ${value} punti ciascuno.`;
}

function tone(value: number) {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

/** Riconosce la voce del calcolo e le dà icona e nome breve. */
function eventOf(label: string): { kind: ScoreIconKind; name: string } | null {
  const text = label.toLowerCase();
  if (text.startsWith("in panchina")) return null;
  if (text.startsWith("6 politico")) return { kind: "political", name: "6 politico" };
  if (text.startsWith("raddoppio")) return { kind: "double", name: "Malus capitano" };
  if (text.includes("rigore segnato")) return { kind: "penalty", name: "Rigore segnato" };
  if (text.includes("sbagliato")) return { kind: "miss", name: "Rigore sbagliato" };
  if (text.includes("parato")) return { kind: "save", name: "Rigore parato" };
  if (text.includes("subito")) return { kind: "conceded", name: "Gol subito" };
  if (text.includes("imbattib")) return { kind: "clean", name: "Porta inviolata" };
  if (text.startsWith("autogol")) return { kind: "own", name: "Autogol" };
  if (text.startsWith("assist")) return { kind: "assist", name: "Assist" };
  if (text.startsWith("ammon")) return { kind: "yellow", name: "Ammonizione" };
  if (text.startsWith("espuls")) return { kind: "red", name: "Espulsione" };
  if (text.startsWith("gol")) return { kind: "goal", name: "Gol" };
  return null;
}

function Chip({ line, counts }: { line: AuditLine; counts: boolean }) {
  const event = eventOf(line.label);
  if (!event || line.count === 0) return null;
  return (
    <li className="td-chip" data-kind={event.kind}>
      <ScoreIcon kind={event.kind} />
      <span>{event.name}{line.count > 1 ? ` ×${line.count}` : ""}</span>
      {counts && line.points !== 0 ? <b data-tone={tone(line.points)}>{signed(line.points)}</b> : null}
    </li>
  );
}

function Player({ player, counts }: { player: AuditPlayer; counts: boolean }) {
  const chips = player.lines.filter((line) => eventOf(line.label) && line.count !== 0);
  return (
    <li className="td-player" data-counts={counts}>
      <span className="role-chip" data-role={player.role}>{ROLE[player.role]}</span>
      <div className="td-who">
        <p className="td-name">
          <strong>{player.name}</strong>
          {player.captain ? <span className="td-captain" title="Capitano" aria-label="Capitano">C</span> : null}
        </p>
        <p className="td-meta">
          {player.club ? <><TeamBadge teamName={player.club} size={14} /> {player.club.toUpperCase()}</> : null}
          {player.replacedName ? <span className="td-swap" data-tone="up"><ScoreIcon kind="in" /> entrato per {player.replacedName}</span> : null}
        </p>
        {chips.length > 0 ? (
          <ul className="td-chips">
            {chips.map((line, index) => <Chip key={`${line.label}-${index}`} line={line} counts={counts} />)}
          </ul>
        ) : null}
      </div>
      <div className="td-score">
        <strong>{counts ? number(player.fantavoto) : number(player.baseVote)}</strong>
        <small>{counts ? (player.baseVote == null ? "senza voto" : `voto ${number(player.baseVote)}`) : player.baseVote == null ? "senza voto" : "voto"}</small>
      </div>
    </li>
  );
}

function Special({ icon, name, note, value }: { icon: ScoreIconKind; name: string; note?: string; value: number }) {
  return (
    <li className="td-special" data-tone={tone(value)}>
      <span className="td-special-icon"><ScoreIcon kind={icon} /></span>
      <span className="td-special-text">
        <strong>{name}</strong>
        {note ? <small>{note}</small> : null}
      </span>
      <b data-tone={tone(value)}>{signed(value)}</b>
    </li>
  );
}

/**
 * Il dettaglio di una squadra in una giornata: da cosa è fatto il totale, i bonus
 * speciali, chi è sceso in campo con i suoi bonus, i cambi e la panchina.
 */
export function TeamDetail({ audit }: { audit: ScoreAudit }) {
  const field = audit.players
    .filter((player) => player.source !== "bench")
    .sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || left.slotOrder - right.slotOrder);
  const out = audit.players
    .filter((player) => player.source === "bench")
    .sort((left, right) => (left.slotKind === right.slotKind ? left.slotOrder - right.slotOrder : left.slotKind === "starter" ? -1 : 1));
  const { captain, defense, fairPlay, reserve } = audit.modifiers;
  const { sum } = audit;
  const fixture = audit.result.fixture;

  return (
    <div className="td">
      <section>
        <h3>Come nasce il totale</h3>
        <ul className="td-specials">
          <li className="td-special">
            <span className="td-special-icon"><ScoreIcon kind="players" /></span>
            <span className="td-special-text"><strong>Voti dei giocatori</strong><small>Voto più bonus e malus di chi è in campo.</small></span>
            <b>{number(sum.playersPoints)}</b>
          </li>
          <Special icon="captain" name="Capitano" note={captain.name && captain.vote != null ? `${captain.name}, voto ${number(captain.vote)}` : italian(captain.note)} value={sum.captain} />
          <Special icon="defense" name="Modificatore difesa" note={defense.enabled ? italian(defense.note) : "Spento in questa lega."} value={sum.defense} />
          {defense.enabled && defense.average != null && defense.rows.length > 0 ? (
            <li className="td-defense">
              {defense.rows.map((row) => (
                <span key={row.playerId} data-used={row.used}>{row.name} <b>{number(row.value)}</b></span>
              ))}
              <small>In chiaro chi entra nella media.</small>
            </li>
          ) : null}
          <Special icon="fairplay" name="Fair play" note={sum.fairPlay > 0 ? "Nessuna ammonizione tra chi ha un voto." : italian(fairPlay.note)} value={sum.fairPlay} />
          {sum.reserve !== 0 || reserve.unfilled > 0 || reserve.shortfall > 0 ? (
            <Special icon="empty" name="Posti vuoti" note={reserve.unfilled + reserve.shortfall > 0 ? emptyNote(reserve.unfilled + reserve.shortfall, reserve.unit) : italian(reserve.note)} value={sum.reserve} />
          ) : null}
          <li className="td-total">
            <span>Totale</span>
            <strong>{number(sum.total)}</strong>
          </li>
        </ul>
        {sum.storedTotal != null && sum.delta !== 0 ? (
          <p className="td-note">Totale salvato in classifica: {number(sum.storedTotal)}.</p>
        ) : null}
        {fixture.kind !== "sum" ? <p className="td-note">{italian(fixture.note)}</p> : null}
      </section>

      <section>
        <h3>In campo</h3>
        <ul className="td-players">
          {field.map((player) => <Player key={player.playerId} player={player} counts />)}
        </ul>
      </section>

      {audit.substitutions.length > 0 ? (
        <section>
          <h3>Cambi</h3>
          <ul className="td-swaps">
            {audit.substitutions.map((step) => (
              <li key={`${step.starterId}-${step.outcome}`} data-empty={!step.entrantId}>
                <ScoreIcon kind={step.entrantId ? "in" : "empty"} />
                <span>{italian(step.text)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3>Non contano</h3>
        {out.length === 0 ? <p className="td-note">Tutta la rosa schierata è in campo.</p> : (
          <ul className="td-players">
            {out.map((player) => <Player key={player.playerId} player={player} counts={false} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
