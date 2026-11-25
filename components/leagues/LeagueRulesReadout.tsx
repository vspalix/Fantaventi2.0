import { CopyInviteLink, ShareJoinCode } from "@/components/leagues/CopyInviteLink";
import { BONUS_FIELDS, COMPETITION_FORMATS, type LeagueRules } from "@/lib/league-rules";
import type { LeagueDetail } from "@/lib/types";

const POINTS = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function points(value: number) {
  return POINTS.format(value);
}

function formatLabel(rules: LeagueRules) {
  return COMPETITION_FORMATS.find((item) => item.id === rules.format)?.label ?? rules.format;
}

export function LeagueRulesReadout({ league }: { league: LeagueDetail }) {
  const rules = league.rules;
  return (
    <div className="stack">
      <section className="card stack">
        <h2>Regole della lega</h2>
        <p className="small muted">Sola lettura. Le modifiche restano all&apos;amministratore della lega.</p>
        <dl className="rule-readout">
          <div><dt>Nome</dt><dd>{league.name}</dd></div>
          <div><dt>Giornate</dt><dd>{league.startMatchday}–{league.endMatchday}</dd></div>
          <div><dt>Formato</dt><dd>{formatLabel(rules)}</dd></div>
          <div><dt>Visibilità</dt><dd>{rules.visibility === "public" ? "Pubblica" : "Privata"}</dd></div>
          <div><dt>Iscrizioni</dt><dd>{rules.enrollment === "closed" ? `Chiuse${rules.maxMembers ? `, ${rules.maxMembers} posti` : ""}` : "Aperte"}</dd></div>
          <div><dt>Rose esclusive</dt><dd>{rules.exclusiveRosters ? "Sì" : "No"}</dd></div>
          <div><dt>Modificatore difesa</dt><dd>{rules.defenseEnabled ? "Attivo" : "Spento"}</dd></div>
          <div><dt>Capitano</dt><dd>{rules.captainEnabled ? (rules.captainMultiplier === 1 ? "Fascia sul voto" : `×${points(rules.captainMultiplier)}`) : "Spento"}</dd></div>
          <div><dt>Formazione non inviata</dt><dd>{rules.missedLineup === "penalty" ? `Penalità ${points(rules.missedLineupPenalty)}` : "Ultima formazione inviata"}</dd></div>
          <div><dt>Imbattibilità portiere</dt><dd>{rules.cleanSheetEnabled ? points(rules.cleanSheetPoints) : "Spenta"}</dd></div>
          <div><dt>Partite rinviate</dt><dd>{rules.postponement === "political_six" ? "6 politico" : "Attesa del recupero"}</dd></div>
          {BONUS_FIELDS.map((field) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>{rules.bonusEnabled[field.key] === false ? "Spento" : points(rules.bonusMalus[field.key])}</dd>
            </div>
          ))}
        </dl>
        {rules.format !== "classic" ? (
          <div className="stack">
            <h3>Soglie gol</h3>
            <ul className="list">
              {rules.goalBands.map((band) => (
                <li key={`${band.min}-${band.goals}`}>Da {points(band.min)} fantapunti: {band.goals} gol</li>
              ))}
            </ul>
          </div>
        ) : null}
        {rules.phases.length > 1 ? (
          <div className="stack">
            <h3>Fasi</h3>
            <ul className="list">
              {rules.phases.map((phase) => (
                <li key={`${phase.kind}-${phase.fromMatchday}`}>
                  {phase.kind === "knockout" ? "Coppa" : "Regular season"} · giornate {phase.fromMatchday}–{phase.toMatchday}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {rules.checkpoints.length > 0 ? (
          <div className="stack">
            <h3>Checkpoint di mercato</h3>
            <ul className="list">
              {rules.checkpoints.map((item) => (
                <li key={item.afterMatchday}>Dopo la giornata {item.afterMatchday}: {item.changes} cambi</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <section className="card stack">
        <h2>Codice invito</h2>
        <div className="code">{league.joinCode}</div>
        <div className="row">
          <CopyInviteLink code={league.joinCode} />
          <ShareJoinCode code={league.joinCode} />
        </div>
      </section>
      <section className="card stack">
        <h2>Partecipanti</h2>
        <ul className="list">
          {league.participants.map((participant) => (
            <li className="person" key={participant.fantasyTeamId}>
              <span className="person-main">
                <strong>{participant.teamName}</strong>
                {participant.displayName ? <span className="small muted">{participant.displayName}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
