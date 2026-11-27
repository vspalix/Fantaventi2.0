"use client";

import { useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import {
  BONUS_FIELDS,
  COMPETITION_FORMATS,
  DEFAULT_LEAGUE_RULES,
  defaultPhases,
  type CompetitionFormat,
  type LeaguePhase,
  type LeagueRules,
} from "@/lib/league-rules";

const STEPS = ["Nome e modalità", "Punteggi", "Chi può entrare", "Rose e mercato", "Formazioni e rinvii"] as const;

/** Le giornate del campionato: `next` è la prima ancora da chiudere. */
export type SeasonCalendar = { next: number; last: number; nextDeadlineAt: string | null };

export type NewLeague = { name: string; rules: LeagueRules; startMatchday: number; endMatchday: number };

const DEADLINE = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

function Choices<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { id: T; label: string; detail?: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <fieldset className="lg-choices">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.id} className="lg-choice">
          <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
          <span className="lg-radio" aria-hidden="true" />
          <span className="lg-choice-text">
            <strong>{option.label}</strong>
            {option.detail ? <small>{option.detail}</small> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Switch({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="lg-switch">
      <span className="lg-choice-text">
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

/** Numero con i tasti − e +, ma si può anche scrivere. */
function Stepper({ label, value, step, min, max, disabled, onChange }: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const clamp = (next: number) => Math.min(max ?? next, Math.max(min ?? next, next));
  return (
    <div className="lg-stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label}: diminuisci`} disabled={disabled || (min !== undefined && value <= min)} onClick={() => onChange(clamp(value - step))}>−</button>
        <input type="number" aria-label={label} step={step} min={min} max={max} disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <button type="button" aria-label={`${label}: aumenta`} disabled={disabled || (max !== undefined && value >= max)} onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}

function Matchday({ label, value, from, to, onChange }: { label: string; value: number; from: number; to: number; onChange: (next: number) => void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {Array.from({ length: Math.max(to - from + 1, 1) }, (_, index) => from + index).map((number) => (
          <option key={number} value={number}>Giornata {number}</option>
        ))}
      </select>
    </label>
  );
}

/** Creazione di una lega in cinque passi. Le scelte restano mentre si va avanti e indietro. */
export function CreateLeagueForm({ pending, calendar, onCreate }: {
  pending: boolean;
  calendar: SeasonCalendar | null;
  onCreate: (league: NewLeague) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [step, setStep] = useState(0);
  const [rules, setRules] = useState<LeagueRules>(DEFAULT_LEAGUE_RULES);
  /** null finché non si sceglie: vale la prima giornata da chiudere e la fine del campionato. */
  const [pickedStart, setPickedStart] = useState<number | null>(null);
  const [pickedEnd, setPickedEnd] = useState<number | null>(null);
  // Le fasi seguono le giornate scelte, finché non le cambi a mano.
  const [editedPhases, setEditedPhases] = useState<LeaguePhase[] | null>(null);
  const next = calendar?.next ?? 1;
  const last = calendar?.last ?? 38;
  const start = Math.min(Math.max(pickedStart ?? next, next), last);
  const end = Math.min(Math.max(pickedEnd ?? last, start), last);
  const phases = editedPhases ?? defaultPhases(rules.format, start, end);
  const nameOk = name.trim().length >= 2;
  const ready = nameOk && calendar !== null;
  const final = step === STEPS.length - 1;
  const headToHead = rules.format !== "classic";

  function change(patch: Partial<LeagueRules>) {
    setRules((current) => ({ ...current, ...patch }));
  }

  function changeRange(nextStart: number | null, nextEnd: number | null) {
    setPickedStart(nextStart);
    setPickedEnd(nextEnd);
    setEditedPhases(null);
  }

  function setPhase(index: number, patch: Partial<LeaguePhase>) {
    setEditedPhases(phases.map((phase, at) => (at === index ? { ...phase, ...patch } : phase)));
  }

  async function submit() {
    // Il tasto Invio porta al passo successivo: la lega si crea solo all'ultimo passo.
    if (!ready) return;
    if (!final) {
      setStep(step + 1);
      return;
    }
    if (await onCreate({ name, rules: { ...rules, phases }, startMatchday: start, endMatchday: end })) {
      setName("");
      setStep(0);
      setRules(DEFAULT_LEAGUE_RULES);
      changeRange(null, null);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="lg-progress">
        <p><span>Passo {step + 1} di {STEPS.length}</span><strong>{STEPS[step]}</strong></p>
        <div aria-hidden="true">
          {STEPS.map((title, index) => <i key={title} data-done={index <= step} />)}
        </div>
      </div>
      {step === 0 ? (
        <>
          <label>
            Nome della lega
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Lega degli uffici" />
          </label>
          <Choices<CompetitionFormat>
            legend="Modalità di gioco"
            name="lg-format"
            value={rules.format}
            options={COMPETITION_FORMATS}
            onChange={(format) => {
              change({ format, ranking: format === "h2h" ? "head_to_head" : "sum" });
              setEditedPhases(null);
            }}
          />
          {calendar ? (
            <>
              <Matchday label="Da quale giornata parte la lega?" value={start} from={next} to={last} onChange={(value) => changeRange(value, pickedEnd)} />
              <p className="lg-hint">
                Le giornate precedenti non contano.
                {calendar.nextDeadlineAt ? ` La giornata ${next} chiude ${DEADLINE.format(new Date(calendar.nextDeadlineAt))}.` : ""}
              </p>
              <Matchday label="Ultima giornata" value={end} from={start} to={last} onChange={(value) => changeRange(pickedStart, value)} />
            </>
          ) : <p className="lg-hint">Leggo le giornate del campionato…</p>}
          {rules.format === "hybrid" ? (
            <>
              <p className="lg-hint">La regular season entra in classifica. La coppa usa gli scontri diretti e resta fuori.</p>
              {phases.map((phase, index) => (
                <div className="lg-pair" key={`${phase.kind}-${index}`}>
                  <strong>{phase.kind === "knockout" ? "Coppa" : "Regular season"}</strong>
                  {phase.kind === "regular" ? (
                    <Choices<LeaguePhase["format"]>
                      legend="Come si gioca"
                      name={`lg-phase-${index}`}
                      value={phase.format}
                      options={[{ id: "classic", label: "Tutti contro tutti" }, { id: "h2h", label: "1 contro 1" }]}
                      onChange={(format) => setPhase(index, { format })}
                    />
                  ) : null}
                  <Matchday label="Dalla" value={phase.fromMatchday} from={start} to={end} onChange={(fromMatchday) => setPhase(index, { fromMatchday, toMatchday: Math.max(fromMatchday, phase.toMatchday) })} />
                  <Matchday label="Alla" value={phase.toMatchday} from={phase.fromMatchday} to={end} onChange={(toMatchday) => setPhase(index, { toMatchday })} />
                </div>
              ))}
            </>
          ) : null}
        </>
      ) : null}
      {step === 1 ? (
        <>
          <Switch label="Modificatore difesa" checked={rules.defenseEnabled} onChange={(defenseEnabled) => change({ defenseEnabled })} />
          <Switch label="Bonus capitano" checked={rules.captainEnabled} onChange={(captainEnabled) => change({ captainEnabled })} />
          {rules.captainEnabled ? (
            <Choices<"1" | "1.5" | "2">
              legend="Quanto vale il capitano"
              name="lg-captain"
              value={String(rules.captainMultiplier) as "1" | "1.5" | "2"}
              options={[
                { id: "1", label: "Fascia sul voto" },
                { id: "1.5", label: "×1,5 sui fantapunti" },
                { id: "2", label: "×2 sui fantapunti" },
              ]}
              onChange={(value) => change({ captainMultiplier: Number(value) as LeagueRules["captainMultiplier"] })}
            />
          ) : null}
          <Switch label="Imbattibilità portiere" checked={rules.cleanSheetEnabled} onChange={(cleanSheetEnabled) => change({ cleanSheetEnabled })} />
          {rules.cleanSheetEnabled ? (
            <Stepper label="Punti imbattibilità" step={0.5} min={0} value={rules.cleanSheetPoints} onChange={(cleanSheetPoints) => change({ cleanSheetPoints })} />
          ) : null}
          <p className="lg-hint">Bonus e malus: togli la spunta alle voci che non vuoi contare.</p>
          <div className="lg-bonus">
            {BONUS_FIELDS.map((field) => {
              const enabled = rules.bonusEnabled[field.key] !== false;
              return (
                <div className="lg-bonus-row" key={field.key}>
                  <input
                    type="checkbox"
                    aria-label={`Conta: ${field.label}`}
                    checked={enabled}
                    onChange={(event) => change({ bonusEnabled: { ...rules.bonusEnabled, [field.key]: event.target.checked } })}
                  />
                  <Stepper
                    label={field.label}
                    step={0.5}
                    disabled={!enabled}
                    value={rules.bonusMalus[field.key]}
                    onChange={(value) => change({ bonusMalus: { ...rules.bonusMalus, [field.key]: value } })}
                  />
                </div>
              );
            })}
          </div>
          {headToHead ? (
            <>
              <p className="lg-hint">Soglie gol: da questi fantapunti in su la squadra segna i gol indicati.</p>
              {rules.goalBands.map((band, index) => (
                <div className="lg-pair" key={index}>
                  <Stepper label={`Soglia ${index + 1}: da punti`} step={1} min={0} value={band.min} onChange={(min) => change({ goalBands: rules.goalBands.map((item, at) => (at === index ? { ...item, min } : item)) })} />
                  <Stepper label={`Soglia ${index + 1}: gol`} step={1} min={0} value={band.goals} onChange={(goals) => change({ goalBands: rules.goalBands.map((item, at) => (at === index ? { ...item, goals } : item)) })} />
                  <button className="text-button" type="button" onClick={() => change({ goalBands: rules.goalBands.filter((_, at) => at !== index) })}>Togli la soglia</button>
                </div>
              ))}
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  const top = rules.goalBands.at(-1);
                  change({ goalBands: [...rules.goalBands, { min: top ? top.min + 6 : 66, goals: top ? top.goals + 1 : 1 }] });
                }}
              >
                Aggiungi soglia
              </button>
            </>
          ) : null}
        </>
      ) : null}
      {step === 2 ? (
        <>
          <Choices<LeagueRules["visibility"]>
            legend="Visibilità"
            name="lg-visibility"
            value={rules.visibility}
            options={[
              { id: "private", label: "Privata", detail: "Si entra con il codice invito." },
              { id: "public", label: "Pubblica", detail: "Compare tra le leghe pubbliche." },
            ]}
            onChange={(visibility) => change({ visibility })}
          />
          <Choices<LeagueRules["enrollment"]>
            legend="Iscrizioni"
            name="lg-enrollment"
            value={rules.enrollment}
            options={[
              { id: "open", label: "Aperta", detail: "Con ingresso in media." },
              { id: "closed", label: "Numero chiuso", detail: "Decidi quanti posti ci sono." },
            ]}
            onChange={(enrollment) => change({ enrollment, maxMembers: enrollment === "closed" ? (rules.maxMembers ?? 8) : null })}
          />
          {rules.enrollment === "closed" ? (
            <Stepper label="Posti" step={1} min={2} value={rules.maxMembers ?? 8} onChange={(maxMembers) => change({ maxMembers })} />
          ) : null}
        </>
      ) : null}
      {step === 3 ? (
        <>
          <p className="lg-hint">La rosa non usa crediti. Vale un calciatore per club e i limiti di ruolo del listone.</p>
          <Switch
            label="Rose esclusive"
            detail="Un calciatore non può stare in due squadre di questa lega."
            checked={rules.exclusiveRosters}
            onChange={(exclusiveRosters) => change({ exclusiveRosters })}
          />
          <p className="lg-hint">Checkpoint di mercato: finestre per cambiare la rosa dopo la giornata scelta. Se non ne aggiungi, non ce ne sono.</p>
          {rules.checkpoints.map((item, index) => (
            <div className="lg-pair" key={index}>
              <Stepper label="Dopo la giornata" step={1} min={start} max={end} value={item.afterMatchday} onChange={(afterMatchday) => change({ checkpoints: rules.checkpoints.map((other, at) => (at === index ? { ...other, afterMatchday } : other)) })} />
              <Stepper label="Cambi massimi" step={1} min={1} value={item.changes} onChange={(changes) => change({ checkpoints: rules.checkpoints.map((other, at) => (at === index ? { ...other, changes } : other)) })} />
              <button className="text-button" type="button" onClick={() => change({ checkpoints: rules.checkpoints.filter((_, at) => at !== index) })}>Togli il checkpoint</button>
            </div>
          ))}
          <button
            className="ghost"
            type="button"
            onClick={() => {
              const previous = rules.checkpoints.at(-1)?.afterMatchday;
              const afterMatchday = Math.min(previous === undefined ? start + 6 : previous + 6, end);
              change({ checkpoints: [...rules.checkpoints, { afterMatchday, changes: 3 }] });
            }}
          >
            Aggiungi checkpoint
          </button>
        </>
      ) : null}
      {step === 4 ? (
        <>
          <Choices<LeagueRules["missedLineup"]>
            legend="Formazione non inviata"
            name="lg-missed"
            value={rules.missedLineup}
            options={[
              { id: "carry", label: "Ultima formazione inviata", detail: "Si riusa quella precedente." },
              { id: "penalty", label: "Penalità fissa", detail: "Nessuna formazione automatica." },
            ]}
            onChange={(missedLineup) => change({ missedLineup })}
          />
          {rules.missedLineup === "penalty" ? (
            <Stepper label="Punti della penalità" step={0.5} value={rules.missedLineupPenalty} onChange={(missedLineupPenalty) => change({ missedLineupPenalty })} />
          ) : null}
          <Choices<LeagueRules["postponement"]>
            legend="Partite rinviate"
            name="lg-postponement"
            value={rules.postponement}
            options={[
              { id: "wait_recovery", label: "Attendi il recupero reale" },
              { id: "political_six", label: "Assegna 6 politico" },
            ]}
            onChange={(postponement) => change({ postponement })}
          />
          <p className="lg-hint">
            <strong>{name.trim()}</strong>: {COMPETITION_FORMATS.find((item) => item.id === rules.format)?.label.toLowerCase()}, dalla giornata {start} alla {end}. Le regole restano sulla lega e il calcolo le legge da lì.
          </p>
        </>
      ) : null}
      <div className="lg-actions">
        {step > 0 ? (
          <button key="back" className="ghost" type="button" onClick={() => setStep(step - 1)}>Indietro</button>
        ) : null}
        {/* Chiavi diverse: «Avanti» non deve trasformarsi nel tasto di invio mentre lo si tocca. */}
        {final ? (
          <button key="create" className="primary" type="submit" disabled={pending || !ready} aria-busy={pending}>
            <BusyLabel pending={pending} idle="Crea lega" busy="Creazione..." />
          </button>
        ) : (
          <button key="next" className="primary" type="button" disabled={!ready} onClick={() => setStep(step + 1)}>
            Avanti
          </button>
        )}
      </div>
    </form>
  );
}
