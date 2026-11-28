import { TeamBadge } from "@/components/TeamBadge";
import { LegendBox } from "@/components/scores/LegendBox";
import { ScoreIcon, type ScoreIconKind } from "@/components/scores/ScoreIcons";
import type { AuditLine, AuditPlayer, ScoreAudit } from "@/lib/engine/score-audit";
import type { PlayerRole } from "@/lib/types";

const ROLE: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };
const ROLE_ORDER: Record<PlayerRole, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

/** Voti e fantavoti: «6», «6,5». */
function number(value: number | null, empty = "S.V.") {
  if (value == null) return empty;
  return value.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

/** Un bonus o un malus: «+3», «−0,5», «0». */
function signed(value: number) {
  if (value === 0) return "0";
  const text = number(Math.abs(value));
  return value > 0 ? `+${text}` : `−${text}`;
}

function tone(value: number) {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

/** Le spiegazioni del calcolo usano il punto per i decimali: qui diventa la virgola. */
function italian(text: string) {
  return text.replace(/(\d)\.(\d)/g, "$1,$2");
}

/** Riconosce la voce del calcolo e le dà icona e nome breve. */
function eventOf(label: string): { kind: ScoreIconKind; name: string } | null {
  const text = label.toLowerCase();
  if (text.startsWith("in panchina")) return null;
  if (text.startsWith("6 politico")) return { kind: "political", name: "6 politico" };
  if (text.startsWith("raddoppio")) return { kind: "double", name: "Malus capitano raddoppiato" };
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

function eventsOf(player: AuditPlayer) {
  return player.lines.flatMap((line: AuditLine) => {
    const event = eventOf(line.label);
    return event && line.count !== 0 ? [{ ...event, line }] : [];
  });
}

function Row({ player, counts, replaced = false }: { player: AuditPlayer; counts: boolean; replaced?: boolean }) {
  return (
    <li className="td-row" data-counts={counts}>
      <span className="td-role" data-role={player.role}>{ROLE[player.role]}</span>
      <span className="td-who">
        <strong>{player.name}</strong>
        {player.captain ? <span className="td-captain" title="Capitano" aria-label="Capitano">C</span> : null}
        {player.vice ? <span className="td-captain td-vice" title="Vice capitano" aria-label="Vice capitano">V</span> : null}
        {player.replacedName ? (
          <span className="td-mark" data-kind="in" title={`Entrato per ${player.replacedName}`} aria-label={`Entrato per ${player.replacedName}`}>
            <ScoreIcon kind="in" />
          </span>
        ) : null}
        {replaced ? (
          <span className="td-mark" data-kind="out" title="Senza voto: sostituito" aria-label="Senza voto: sostituito"><ScoreIcon kind="out" /></span>
        ) : null}
        {player.held ? <small>partita rinviata</small> : null}
        {player.club ? (
          <span className="td-club"><TeamBadge teamName={player.club} size={11} />{player.club.slice(0, 3).toUpperCase()}</span>
        ) : null}
        {eventsOf(player).map(({ kind, name, line }, index) => {
          const label = `${name}${line.count > 1 ? ` ×${line.count}` : ""}${counts && line.points !== 0 ? ` ${signed(line.points)}` : ""}`;
          return (
            <span className="td-mark" data-kind={kind} key={`${line.label}-${index}`} title={label} aria-label={label}>
              <ScoreIcon kind={kind} />
              {line.count > 1 ? <b>{line.count}</b> : null}
            </span>
          );
        })}
      </span>
      <span className="td-vote">{number(player.baseVote)}</span>
      <span className="td-fanta">{counts ? number(player.fantavoto, "–") : "–"}</span>
    </li>
  );
}

function Sum({ name, note, value, plain = false }: { name: string; note?: string; value: number; plain?: boolean }) {
  return (
    <li className="td-sum">
      <span>
        <strong>{name}</strong>
        {note ? <small>{note}</small> : null}
      </span>
      <b data-tone={plain ? undefined : tone(value)}>{plain ? number(value) : signed(value)}</b>
    </li>
  );
}

/**
 * Il dettaglio di una squadra in una giornata, compatto: una riga per calciatore
 * con voto e fantavoto, poi la panchina e in fondo il riepilogo che porta al totale.
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
  const swaps = audit.substitutions.filter((step) => step.entrantName);
  const replacedIds = new Set(swaps.map((step) => step.starterId));
  const holes = reserve.unfilled + reserve.shortfall;
  const holeNames = audit.substitutions.filter((step) => !step.entrantId).map((step) => step.starterName);

  // La legenda spiega solo le icone che si vedono davvero, con quanto vale ciascuna.
  const legend = new Map<ScoreIconKind, string>();
  for (const player of audit.players) {
    for (const { kind, name, line } of eventsOf(player)) {
      legend.set(kind, kind === "political" || kind === "double" ? name : `${name} ${signed(line.unit)}`);
    }
  }

  return (
    <div className="td">
      <div className="td-head">
        <span>In campo</span>
        <span>Voto</span>
        <span title="Fantavoto">FV</span>
      </div>
      <ul className="td-list">
        {field.map((player) => <Row key={player.playerId} player={player} counts />)}
        {Array.from({ length: holes }, (_, index) => (
          <li className="td-row td-hole" key={`vuoto-${index}`}>
            <span className="td-role"><ScoreIcon kind="empty" /></span>
            <span className="td-who">
              <strong>Posto vuoto</strong>
              {holeNames[index] ? <small>{holeNames[index]} senza voto</small> : null}
            </span>
            <span className="td-vote" />
            <span className="td-fanta">{number(reserve.unit)}</span>
          </li>
        ))}
      </ul>

      {out.length > 0 ? (
        <>
          <div className="td-head"><span>Panchina</span></div>
          <ul className="td-list">
            {out.map((player) => <Row key={player.playerId} player={player} counts={false} replaced={replacedIds.has(player.playerId)} />)}
          </ul>
        </>
      ) : null}

      <div className="td-head"><span>Riepilogo</span></div>
      <ul className="td-sums">
        {/* I posti vuoti sono righe in campo, ma nel totale hanno la loro voce. */}
        <Sum name="Calciatori in campo" value={sum.playersPoints} plain />
        <Sum name="Capitano" note={captain.name && captain.vote != null ? `${captain.name}, voto ${number(captain.vote)}` : italian(captain.note)} value={sum.captain} />
        <Sum
          name="Modificatore difesa"
          note={!defense.enabled
            ? "Spento in questa lega"
            : defense.average != null
              ? `Media ${number(defense.average)}: ${defense.rows.filter((row) => row.used).map((row) => row.name).join(", ")}`
              : italian(defense.note)}
          value={sum.defense}
        />
        <Sum name="Fair play" note={sum.fairPlay > 0 ? "Nessuna ammonizione" : italian(fairPlay.note)} value={sum.fairPlay} />
        {sum.reserve !== 0 || holes > 0 ? (
          <Sum name="Posti vuoti" note={holes > 0 ? `${holes} × ${number(reserve.unit)}` : italian(reserve.note)} value={sum.reserve} />
        ) : null}
        <li className="td-total">
          <span>Totale</span>
          <strong>{number(sum.total)}</strong>
        </li>
      </ul>

      {swaps.length > 0 ? (
        <p className="td-note">Cambi: {swaps.map((step) => `${step.entrantName} per ${step.starterName}`).join(" · ")}.</p>
      ) : null}
      {sum.storedTotal != null && sum.delta !== 0 ? <p className="td-note">Totale salvato in classifica: {number(sum.storedTotal)}.</p> : null}
      {fixture.kind !== "sum" ? <p className="td-note">{italian(fixture.note)}</p> : null}
      {legend.size > 0 ? (
        <LegendBox>
          <ul className="td-legend">
            {[...legend].map(([kind, text]) => (
              <li key={kind}><span className="td-mark" data-kind={kind}><ScoreIcon kind={kind} /></span>{text}</li>
            ))}
          </ul>
        </LegendBox>
      ) : null}
    </div>
  );
}
