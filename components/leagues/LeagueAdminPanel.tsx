"use client";

import { useState } from "react";
import {
  BONUS_FIELDS,
  COMPETITION_FORMATS,
  defaultPhases,
  type CompetitionFormat,
  type GoalBand,
  type LeaguePhase,
  type LeagueRules,
} from "@/lib/league-rules";
import { CopyInviteLink } from "@/components/leagues/CopyInviteLink";
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
  const [delegateId, setDelegateId] = useState("");
  const format = COMPETITION_FORMATS.find((item) => item.id === rules.format) ?? COMPETITION_FORMATS[0];
  const candidates = league.participants.filter((participant) => (
    participant.userId !== ""
    && !league.delegates.some((delegate) => delegate.userId === participant.userId)
  ));

  function setFormat(value: CompetitionFormat) {
    setRules((current) => ({
      ...current,
      format: value,
      ranking: value === "h2h" ? "head_to_head" : "sum",
      phases: value === current.format ? current.phases : defaultPhases(value),
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
          <button className="ghost" type="button" onClick={() => void navigator.clipboard.writeText(league.joinCode)}>Copia codice</button>
          <button className="ghost" type="button" disabled={pending} onClick={() => void onSave({ name, startMatchday, endMatchday, regenerateCode: true, rules })}>
            Genera un nuovo codice
          </button>
        </div>
        <ul className="list">
          {league.participants.map((participant) => (
            <li className="person" key={participant.fantasyTeamId}>
              <span className="person-main">
                <strong>{participant.teamName}</strong>
                <span className="small muted">{participant.displayName}</span>
              </span>
              <button className="text-button" type="button" disabled={pending} onClick={() => void onRemove(participant.fantasyTeamId)}>
                Rimuovi
              </button>
            </li>
          ))}
        </ul>
        {league.isOwner ? (
          <div className="stack">
            <h3>Admin delegati</h3>
            <p className="small muted">Gestiscono inviti, partecipanti e regole di questa lega. Il Laboratorio globale resta solo del super admin.</p>
            <ul className="list">
              {league.delegates.length === 0 ? <li>Nessun admin delegato.</li> : league.delegates.map((delegate) => (
                <li className="person" key={delegate.userId}>
                  <span>{delegate.displayName}</span>
                  <button className="text-button" type="button" disabled={pending} onClick={() => void onRevoke(delegate.userId)}>Revoca</button>
                </li>
              ))}
            </ul>
            <div className="row">
              <select value={delegateId} onChange={(event) => setDelegateId(event.target.value)}>
                <option value="">Scegli un partecipante</option>
                {candidates.map((participant) => (
                  <option key={participant.userId} value={participant.userId}>{participant.displayName}</option>
                ))}
              </select>
              <button className="ghost" type="button" disabled={pending || delegateId === ""} onClick={() => void onGrant(delegateId)}>Nomina admin</button>
            </div>
          </div>
        ) : <p className="small muted">Sei admin delegato di questa lega. Non hai accesso al Laboratorio globale.</p>}
      </section>

      <form className="card stack" onSubmit={(event) => { event.preventDefault(); void onSave({ name, startMatchday, endMatchday, rules }); }}>
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
          Formato
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
                    <option value="classic">Somma punti</option>
                    <option value="h2h">Scontri diretti</option>
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
        <div className="stack">
          <h3>Checkpoint di mercato</h3>
          <p className="small muted">Ogni riga è una finestra dopo quella giornata. I cambi massimi valgono finché la giornata successiva non è calcolata. Resta il vincolo di un calciatore per club.</p>
          {rules.checkpoints.map((item, index) => (
            <div className="row" key={`${item.afterMatchday}-${index}`}>
              <label>
                Dopo la giornata
                <input
                  type="number"
                  min={1}
                  value={item.afterMatchday}
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
                onClick={() => setRules((current) => ({
                  ...current,
                  checkpoints: current.checkpoints.filter((_, checkpointIndex) => checkpointIndex !== index),
                }))}
              >
                Togli
              </button>
            </div>
          ))}
          <button
            className="ghost"
            type="button"
            onClick={() => setRules((current) => ({
              ...current,
              checkpoints: [...current.checkpoints, { afterMatchday: 10, changes: 3 }],
            }))}
          >
            Aggiungi checkpoint
          </button>
        </div>
        <button className="primary" type="submit" disabled={pending || name.trim().length < 2}>Salva la lega</button>
      </form>
    </div>
  );
}
