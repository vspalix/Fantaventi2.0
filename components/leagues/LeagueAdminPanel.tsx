"use client";

import { useState } from "react";
import { useTapGuard } from "@/components/useTapGuard";
import {
  BONUS_FIELDS,
  COMPETITION_FORMATS,
  defaultPhases,
  type CompetitionFormat,
  type GoalBand,
  type LeaguePhase,
  type LeagueRules,
} from "@/lib/league-rules";
import { BusyLabel } from "@/components/BusyLabel";
import { CopyInviteLink, ShareJoinCode } from "@/components/leagues/CopyInviteLink";
import type { LeagueDetail } from "@/lib/types";

export function LeagueAdminPanel({
  league,
  pending,
  onSave,
  onRemove,
  onGrant,
  onRevoke,
}: {
  league: LeagueDetail;
  pending: boolean;
  onSave: (input: {
    name: string;
    startMatchday: number;
    endMatchday: number;
    regenerateCode?: boolean;
    rules: LeagueRules;
  }) => Promise<void>;
  onRemove: (fantasyTeamId: string) => Promise<void>;
  onGrant: (userId: string) => Promise<void>;
  onRevoke: (userId: string) => Promise<void>;
}) {
  const [name, setName] = useState(league.name);
  const [startMatchday, setStartMatchday] = useState(league.startMatchday);
  const [endMatchday, setEndMatchday] = useState(league.endMatchday);
  const [rules, setRules] = useState<LeagueRules>(league.rules);
  const [confirm, setConfirm] = useState<null | { kind: "remove" | "grant" | "revoke"; id: string; label: string }>(null);
  const taps = useTapGuard();
  const format = COMPETITION_FORMATS.find((item) => item.id === rules.format) ?? COMPETITION_FORMATS[0];

  function ask(kind: "remove" | "grant" | "revoke", id: string, label: string) {
    setConfirm({ kind, id, label });
  }

  function commit() {
    if (!confirm) return;
    const next = confirm;
    setConfirm(null);
    if (next.kind === "remove") void onRemove(next.id);
    if (next.kind === "grant") void onGrant(next.id);
    if (next.kind === "revoke") void onRevoke(next.id);
  }

  function setFormat(value: CompetitionFormat) {
    setRules((current) => ({
      ...current,
      format: value,
      ranking: value === "h2h" ? "head_to_head" : "sum",
      phases: value === current.format ? current.phases : defaultPhases(value, startMatchday, endMatchday),
    }));
  }

  function setPhase(index: number, patch: Partial<LeaguePhase>) {
    setRules((current) => ({
      ...current,
      phases: current.phases.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, ...patch } : phase),
    }));
  }

  function setBonus(key: keyof LeagueRules["bonusMalus"], value: string) {
    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed)) return;
    setRules((current) => ({ ...current, bonusMalus: { ...current.bonusMalus, [key]: parsed } }));
  }

  function setBand(index: number, field: keyof GoalBand, value: string) {
    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed)) return;
    setRules((current) => ({
      ...current,
      goalBands: current.goalBands.map((band, bandIndex) => (
        bandIndex === index ? { ...band, [field]: field === "goals" ? Math.max(0, Math.trunc(parsed)) : parsed } : band
      )),
    }));
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Inviti e partecipanti</h2>
        <div className="code">{league.joinCode}</div>
        <div className="row">
          <CopyInviteLink code={league.joinCode} />
          <ShareJoinCode code={league.joinCode} />
          <button className="ghost" type="button" disabled={pending} onClick={() => void onSave({ name, startMatchday, endMatchday, regenerateCode: true, rules })}>
            Genera un nuovo codice
          </button>
        </div>
        <ul className="list">
          {league.participants.map((participant) => {
            const role = participant.role ?? "member";
            const handle = participant.displayName || participant.teamName;
            return (
              <li className="person" key={participant.fantasyTeamId}>
                <span className="person-main">
                  <strong>{participant.teamName}</strong>
                  {participant.displayName ? <span className="small muted">{participant.displayName}</span> : null}
                  {role === "owner" ? <span className="small muted">Amministratore</span> : null}
                  {role === "admin" ? <span className="small muted">Admin di lega</span> : null}
                </span>
                <span className="row">
                  {league.isOwner && role === "member" && participant.userId ? (
                    <button className="text-button" type="button" disabled={pending} onClick={() => ask("grant", participant.userId, handle)}>
                      Rendi admin
                    </button>
                  ) : null}
                  {league.isOwner && role === "admin" ? (
                    <button className="text-button" type="button" disabled={pending} onClick={() => ask("revoke", participant.userId, handle)}>
                      Revoca admin
                    </button>
                  ) : null}
                  {role !== "owner" ? (
                    <button className="text-button" type="button" disabled={pending} onClick={() => ask("remove", participant.fantasyTeamId, participant.teamName)}>
                      Rimuovi
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        {league.isOwner ? (
          <p className="small muted">Un admin di lega gestisce inviti, partecipanti e regole. Il Laboratorio globale resta solo del super admin.</p>
        ) : <p className="small muted">Sei admin di questa lega. Non hai accesso al Laboratorio globale.</p>}
        {confirm ? (
          <div className="modal-backdrop confirm-backdrop" role="presentation">
            <div className="modal stack" role="dialog" aria-modal="true" aria-labelledby="member-confirm-title">
              <h2 id="member-confirm-title">
                {confirm.kind === "remove" ? "Togliere il partecipante?" : confirm.kind === "grant" ? "Nominare admin di lega?" : "Revocare l'admin?"}
              </h2>
              <p>
                {confirm.kind === "remove"
                  ? `${confirm.label} esce dalla lega. La scelta non parte finché non confermi.`
                  : confirm.kind === "grant"
                    ? `${confirm.label} potrà modificare regole e partecipanti di questa lega.`
                    : `${confirm.label} torna partecipante e non modifica più le regole.`}
              </p>
              <div className="row">
                <button className={confirm.kind === "remove" ? "danger solid" : "primary"} type="button" onClick={commit}>
                  {confirm.kind === "remove" ? "Togli dalla lega" : confirm.kind === "grant" ? "Nomina admin" : "Revoca admin"}
                </button>
                <button className="ghost" type="button" onClick={() => setConfirm(null)}>Annulla</button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <form id="league-rules-form" className="card stack" data-pending={pending} onSubmit={(event) => { event.preventDefault(); if (taps.locked) return; void onSave({ name, startMatchday, endMatchday, rules }); }}>
        <h2>Formato e calcolo</h2>
        <label>
          Nome della lega
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="row">
          <label>
            Dalla giornata
            <input type="number" min={1} value={startMatchday} onChange={(event) => setStartMatchday(Number(event.target.value))} />
          </label>
          <label>
            Alla giornata
            <input type="number" min={1} value={endMatchday} onChange={(event) => setEndMatchday(Number(event.target.value))} />
          </label>
        </div>
        <label>
          Modalità di gioco
          <select value={rules.format} onChange={(event) => setFormat(event.target.value as CompetitionFormat)}>
            {COMPETITION_FORMATS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <p className="small muted">{format.detail}</p>
        <label className="row">
          <input
            type="checkbox"
            checked={rules.exclusiveRosters}
            onChange={(event) => setRules((current) => ({ ...current, exclusiveRosters: event.target.checked }))}
          />
          Rose esclusive
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={rules.defenseEnabled}
            onChange={(event) => setRules((current) => ({ ...current, defenseEnabled: event.target.checked }))}
          />
          Modificatore difesa
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={rules.captainEnabled}
            onChange={(event) => setRules((current) => ({ ...current, captainEnabled: event.target.checked }))}
          />
          Bonus capitano
        </label>
        {rules.captainEnabled ? (
          <label>
            Moltiplicatore capitano
            <select
              value={String(rules.captainMultiplier)}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                const captainMultiplier = parsed === 1.5 || parsed === 2 ? parsed : 1;
                setRules((current) => ({ ...current, captainMultiplier }));
              }}
            >
              <option value="1">Fascia sul voto</option>
              <option value="1.5">×1,5 sui fantapunti del capitano</option>
              <option value="2">×2 sui fantapunti del capitano</option>
            </select>
          </label>
        ) : null}
        <label>
          Formazione non inviata
          <select
            value={rules.missedLineup}
            onChange={(event) => setRules((current) => ({
              ...current,
              missedLineup: event.target.value === "penalty" ? "penalty" : "carry",
            }))}
          >
            <option value="carry">Ultima formazione inviata</option>
            <option value="penalty">Penalità fissa</option>
          </select>
        </label>
        {rules.missedLineup === "penalty" ? (
          <label>
            Punti della penalità
            <input
              inputMode="decimal"
              value={String(rules.missedLineupPenalty)}
              onChange={(event) => {
                const parsed = Number(event.target.value.replace(",", "."));
                if (!Number.isFinite(parsed)) return;
                setRules((current) => ({ ...current, missedLineupPenalty: parsed }));
              }}
            />
          </label>
        ) : null}
        <label className="row">
          <input
            type="checkbox"
            checked={rules.cleanSheetEnabled}
            onChange={(event) => setRules((current) => ({ ...current, cleanSheetEnabled: event.target.checked }))}
          />
          Imbattibilità portiere
        </label>
        {rules.cleanSheetEnabled ? (
          <label>
            Punti imbattibilità
            <input
              inputMode="decimal"
              value={String(rules.cleanSheetPoints)}
              onChange={(event) => {
                const parsed = Number(event.target.value.replace(",", "."));
                if (!Number.isFinite(parsed)) return;
                setRules((current) => ({ ...current, cleanSheetPoints: parsed }));
              }}
            />
          </label>
        ) : null}
        <label>
          Partite rinviate
          <select
            value={rules.postponement}
            onChange={(event) => setRules((current) => ({
              ...current,
              postponement: event.target.value === "political_six" ? "political_six" : "wait_recovery",
            }))}
          >
            <option value="wait_recovery">Attesa del recupero</option>
            <option value="political_six">6 politico</option>
          </select>
        </label>
        <h3>Bonus e malus</h3>
        <div className="row">
          {BONUS_FIELDS.map((field) => (
            <label key={field.key}>
              <span className="row">
                <input
                  type="checkbox"
                  checked={rules.bonusEnabled[field.key] !== false}
                  onChange={(event) => setRules((current) => ({
                    ...current,
                    bonusEnabled: { ...current.bonusEnabled, [field.key]: event.target.checked },
                  }))}
                />
                {field.label}
              </span>
              <input
                inputMode="decimal"
                value={String(rules.bonusMalus[field.key])}
                onChange={(event) => setBonus(field.key, event.target.value)}
              />
            </label>
          ))}
        </div>
        {rules.format === "hybrid" ? (
          <div className="stack">
            <h3>Fasi</h3>
            <p className="small muted">La regular season entra in classifica. La coppa usa gli scontri diretti e resta fuori da quella classifica.</p>
            {rules.phases.map((phase, index) => (
              <div className="row" key={`${phase.kind}-${index}`}>
                <strong>{phase.kind === "knockout" ? "Coppa" : "Regular season"}</strong>
                {phase.kind === "regular" ? (
                  <select
                    value={phase.format}
                    onChange={(event) => setPhase(index, { format: event.target.value === "h2h" ? "h2h" : "classic" })}
                  >
                    <option value="classic">Tutti contro tutti</option>
                    <option value="h2h">1 contro 1</option>
                  </select>
                ) : <span className="small muted">Eliminazione diretta</span>}
                <label>
                  Dalla
                  <input
                    type="number"
                    min={1}
                    value={phase.fromMatchday}
                    onChange={(event) => setPhase(index, { fromMatchday: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Alla
                  <input
                    type="number"
                    min={1}
                    value={phase.toMatchday}
                    onChange={(event) => setPhase(index, { toMatchday: Number(event.target.value) })}
                  />
                </label>
              </div>
            ))}
          </div>
        ) : null}
        {rules.format === "h2h" || rules.format === "hybrid" ? (
          <div className="stack">
            <h3>Soglie gol</h3>
            <p className="small muted">Da questi fantapunti in su, la squadra segna i gol indicati. Sotto la prima soglia il gol è 0.</p>
            {rules.goalBands.map((band, index) => (
              <div className="row" key={`${band.min}-${index}`}>
                <label>
                  Da fantapunti
                  <input inputMode="decimal" value={String(band.min)} onChange={(event) => setBand(index, "min", event.target.value)} />
                </label>
                <label>
                  Gol
                  <input inputMode="numeric" value={String(band.goals)} onChange={(event) => setBand(index, "goals", event.target.value)} />
                </label>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setRules((current) => ({ ...current, goalBands: current.goalBands.filter((_, bandIndex) => bandIndex !== index) }))}
                >
                  Togli
                </button>
              </div>
            ))}
            <button
              className="ghost"
              type="button"
              onClick={() => setRules((current) => ({ ...current, goalBands: [...current.goalBands, { min: 66, goals: 1 }] }))}
            >
              Aggiungi soglia
            </button>
          </div>
        ) : null}
        <div className="stack checkpoint-editor">
          <h3>Checkpoint di mercato</h3>
          <p className="small muted">Ogni scheda è una finestra dopo quella giornata. I cambi massimi valgono finché la giornata successiva non è calcolata. Resta il vincolo di un calciatore per club.</p>
          {rules.checkpoints.map((item, index) => (
            <article className="person-card" key={`${item.afterMatchday}-${index}`}>
              <strong>Checkpoint {index + 1}</strong>
              <div className="person-card-meta">
                <span className="status-pill">Dopo la giornata {item.afterMatchday}</span>
                <span className="small">{item.changes} cambi</span>
              </div>
              <label>
                Dopo la giornata
                <input
                  type="number"
                  min={1}
                  value={item.afterMatchday}
                  disabled={pending || taps.locked}
                  onChange={(event) => {
                    const afterMatchday = Number(event.target.value);
                    setRules((current) => ({
                      ...current,
                      checkpoints: current.checkpoints.map((checkpoint, checkpointIndex) => (
                        checkpointIndex === index ? { ...checkpoint, afterMatchday } : checkpoint
                      )),
                    }));
                  }}
                />
              </label>
              <label>
                Cambi massimi
                <input
                  type="number"
                  min={1}
                  value={item.changes}
                  disabled={pending || taps.locked}
                  onChange={(event) => {
                    const changes = Number(event.target.value);
                    setRules((current) => ({
                      ...current,
                      checkpoints: current.checkpoints.map((checkpoint, checkpointIndex) => (
                        checkpointIndex === index ? { ...checkpoint, changes } : checkpoint
                      )),
                    }));
                  }}
                />
              </label>
              <button
                className="ghost"
                type="button"
                disabled={pending || taps.locked}
                aria-busy={taps.busyId === `drop-${index}`}
                onClick={() => taps.hold(`drop-${index}`, () => setRules((current) => ({
                  ...current,
                  checkpoints: current.checkpoints.filter((_, checkpointIndex) => checkpointIndex !== index),
                })))}
              >
                {taps.busyId === `drop-${index}` ? <span className="spinner" aria-hidden="true" /> : null}
                Togli
              </button>
            </article>
          ))}
          <button
            className="ghost"
            type="button"
            disabled={pending || taps.locked}
            aria-busy={taps.busyId === "add-checkpoint"}
            onClick={() => taps.hold("add-checkpoint", () => setRules((current) => ({
              ...current,
              checkpoints: [...current.checkpoints, { afterMatchday: 10, changes: 3 }],
            })))}
          >
            {taps.busyId === "add-checkpoint" ? <span className="spinner" aria-hidden="true" /> : null}
            Aggiungi checkpoint
          </button>
        </div>
      </form>
      <div className="thumb-bar">
        <button className="primary" type="submit" form="league-rules-form" disabled={pending || taps.locked || name.trim().length < 2} aria-busy={pending}>
          <BusyLabel pending={pending} idle="Salva la lega" busy="Salvataggio..." />
        </button>
      </div>
    </div>
  );
}
