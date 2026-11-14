import type { ScoreAudit } from "@/lib/engine/score-audit";
import type { PlayerRole } from "@/lib/types";

const ROLE: Record<PlayerRole, string> = { GK: "P", DEF: "D", MID: "C", FWD: "A" };

function points(value: number | null) {
  if (value == null) return "S.V.";
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function signed(value: number) {
  const text = points(value);
  return value > 0 ? `+${text}` : text;
}

export function MatchdayBreakdown({ audit, onDownload }: { audit: ScoreAudit; onDownload?: () => void }) {
  const sumRows = [
    ["Fantavoti", audit.sum.playersPoints],
    ["Capitano", audit.sum.captain],
    ["Fair play", audit.sum.fairPlay],
    ["Difesa", audit.sum.defense],
    ["Posti vuoti", audit.sum.reserve],
  ] as const;
  return (
    <div className="stack">
      <section className="stack">
        <h3>Giocatori in campo</h3>
        <div className="sheet-scroll">
          <table className="standings as-cards">
            <thead>
              <tr>
                <th>Giocatore</th>
                <th>Ruolo</th>
                <th>Voto base</th>
                <th>Bonus e malus</th>
                <th>FantaVoto</th>
              </tr>
            </thead>
            <tbody>
              {audit.players.map((player) => (
                <tr key={player.playerId}>
                  <td data-label="Giocatore">
                    <strong>{player.name}</strong>
                    {player.captain ? <span className="small muted"> · capitano</span> : null}
                    {player.source === "substitute" ? <span className="small muted"> · entra per {player.replacedName}</span> : null}
                    {player.source === "bench" ? <span className="small muted"> · in panchina</span> : null}
                  </td>
                  <td data-label="Ruolo">{ROLE[player.role]}</td>
                  <td data-label="Voto base">{points(player.baseVote)}</td>
                  <td data-label="Bonus e malus">
                    {player.lines.length === 0 ? <span className="muted">Nessuno</span> : (
                      <ul className="audit-lines">
                        {player.lines.map((line) => (
                          <li key={line.label} className={line.points < 0 ? "bonus-minus" : line.points > 0 ? "bonus-plus" : undefined}>
                            {line.label}{line.count > 1 ? ` × ${line.count}` : ""} {signed(line.points)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td data-label="FantaVoto">{points(player.fantavoto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        <h3>Sostituzioni</h3>
        {audit.substitutions.length === 0 ? (
          <p>Nessun titolare senza voto. Tutti gli schierati restano in campo.</p>
        ) : (
          <ol className="audit-log">
            {audit.substitutions.map((step) => (
              <li key={`${step.starterId}-${step.outcome}`}>{step.text}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="stack">
        <h3>Modificatori</h3>
        <p><strong>Capitano.</strong> {audit.modifiers.captain.note}</p>
        <p><strong>Fair play.</strong> {audit.modifiers.fairPlay.note}</p>
        <p><strong>Difesa.</strong> {audit.modifiers.defense.note}</p>
        {audit.modifiers.defense.rows.length > 0 ? (
          <ul className="audit-lines">
            {audit.modifiers.defense.rows.map((row) => (
              <li key={row.playerId}>
                {row.name} ({ROLE[row.role]}) {points(row.value)}
                {row.used ? " · entra in media" : " · fuori media"}
              </li>
            ))}
          </ul>
        ) : null}
        <p><strong>Posti vuoti.</strong> {audit.modifiers.reserve.note}</p>
      </section>

      <section className="stack">
        <h3>Totale</h3>
        <table className="standings">
          <tbody>
            {sumRows.map(([label, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{signed(value)}</td>
              </tr>
            ))}
            <tr>
              <th>FantaPunti</th>
              <td><strong>{points(audit.sum.total)}</strong></td>
            </tr>
          </tbody>
        </table>
        {audit.sum.storedTotal != null ? (
          <p>
            Totale salvato: {points(audit.sum.storedTotal)}.
            {audit.sum.delta === 0 ? " Coincide con questo dettaglio." : ` Scarto ${signed(audit.sum.delta ?? 0)}.`}
          </p>
        ) : (
          <p>Per questa squadra non c’è ancora un totale salvato.</p>
        )}
        <p>{audit.result.fixture.note}</p>
        <p className="small muted">{audit.result.goalConversion.note}</p>
        {onDownload ? <button className="primary" type="button" onClick={onDownload}>Scarica log JSON</button> : null}
      </section>
    </div>
  );
}
