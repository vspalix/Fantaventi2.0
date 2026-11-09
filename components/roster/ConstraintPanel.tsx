import { roleInRange, type ConstraintReport } from "@/lib/constraints";
import type { PlayerRole, RosterRules } from "@/lib/types";

const ROLES: PlayerRole[] = ["GK", "DEF", "MID", "FWD"];

export function ConstraintPanel({ report, rules }: { report: ConstraintReport; rules: RosterRules }) {
  return (
    <section className="constraints" aria-live="polite">
      <article className="stat" data-ok={report.totalOk}>
        <span className="small muted">Rosa</span>
        <strong>{report.total}/{rules.squadSize}</strong>
      </article>
      <article className="stat" data-ok={report.clubsOk}>
        <span className="small muted">Un calciatore per club</span>
        <strong>{rules.squadSize - report.missingClubs.length}/{rules.squadSize}</strong>
        {report.duplicateClubs.length > 0 ? (
          <div className="club-pills">
            {report.duplicateClubs.map((club) => (
              <span key={club.id} data-bad="true">{club.shortName} ×{club.count}</span>
            ))}
          </div>
        ) : null}
      </article>
      <article className="stat" data-ok={report.rolesOk}>
        <span className="small muted">Ruoli GK {rules.gkMin}-{rules.gkMax}, altri {rules.outfieldMin}-{rules.outfieldMax}</span>
        <div className="club-pills">
          {ROLES.map((role) => (
            <span key={role} data-bad={!roleInRange(role, report.roles[role], rules)}>
              {role} {report.roles[role]}
            </span>
          ))}
        </div>
      </article>
    </section>
  );
}
