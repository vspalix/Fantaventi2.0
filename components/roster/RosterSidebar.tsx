import type { CatalogPlayer, PlayerRole, RosterRules } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";
import type { ConstraintReport } from "@/lib/constraints";
import { roleInRange } from "@/lib/constraints";

const ROLES: PlayerRole[] = ["GK", "DEF", "MID", "FWD"];

function roleMax(role: PlayerRole, rules: RosterRules) {
  return role === "GK" ? rules.gkMax : rules.outfieldMax;
}

export function RosterSidebar({
  report,
  rules,
  selected,
  roleFocus,
  onRoleFocus,
  onOpenClub,
}: {
  report: ConstraintReport;
  rules: RosterRules;
  selected: CatalogPlayer[];
  roleFocus: PlayerRole | null;
  onRoleFocus: (role: PlayerRole | null) => void;
  onOpenClub: (clubId: string) => void;
}) {
  return (
    <aside className="panel roster-side">
      <section>
        <h2>Vincoli</h2>
        <p className="side-total" data-ok={report.totalOk}>
          {report.total}/{rules.squadSize} calciatori
        </p>
      </section>

      <section>
        <h3>Ruoli</h3>
        <div className="side-list">
          {ROLES.map((role) => {
            const count = report.roles[role];
            const full = count >= roleMax(role, rules);
            const ok = roleInRange(role, count, rules);
            return (
              <button
                key={role}
                type="button"
                className="side-row"
                data-covered={full}
                data-ok={ok}
                data-active={roleFocus === role}
                onClick={() => onRoleFocus(roleFocus === role ? null : role)}
              >
                <span className="player-main">
                  <strong>{ROLE_LABEL[role]}</strong>
                  <span className="small muted">
                    {role === "GK" ? `${rules.gkMin}–${rules.gkMax}` : `${rules.outfieldMin}–${rules.outfieldMax}`}
                  </span>
                </span>
                <span className={`badge ${role}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3>Squadre</h3>
        <div className="side-list side-clubs">
          {report.clubs.map((club) => {
            const chosen = selected.find((player) => player.clubId === club.id);
            return (
              <button
                key={club.id}
                type="button"
                className="side-row"
                data-covered={Boolean(chosen)}
                onClick={() => onOpenClub(club.id)}
              >
                <span className="player-main">
                  <strong>{club.shortName}</strong>
                  <span className="small muted">{chosen ? chosen.fullName : club.name}</span>
                </span>
                <span className="small">{chosen ? "✓" : "Apri"}</span>
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
