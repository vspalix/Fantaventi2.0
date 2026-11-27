"use client";

import { useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { BONUS_FIELDS, COMPETITION_FORMATS, DEFAULT_LEAGUE_RULES, defaultPhases, type CompetitionFormat, type LeagueRules } from "@/lib/league-rules";

const STEPS = ["Nome e formato", "Bonus e malus", "Chi può entrare", "Rose e rinvii"] as const;

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
function Stepper({ label, value, step, min, onChange }: { label: string; value: number; step: number; min?: number; onChange: (next: number) => void }) {
  const clamp = (next: number) => (min === undefined ? next : Math.max(min, next));
  return (
    <div className="lg-stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label}: diminuisci`} disabled={min !== undefined && value <= min} onClick={() => onChange(clamp(value - step))}>−</button>
        <input type="number" aria-label={label} step={step} min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <button type="button" aria-label={`${label}: aumenta`} onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}

/** Creazione di una lega in quattro passi. Le scelte restano mentre si va avanti e indietro. */
export function CreateLeagueForm({ pending, onCreate }: { pending: boolean; onCreate: (name: string, rules: LeagueRules) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [step, setStep] = useState(0);
  const [rules, setRules] = useState<LeagueRules>(DEFAULT_LEAGUE_RULES);
  const nameOk = name.trim().length >= 2;
  const last = step === STEPS.length - 1;

  async function submit() {
    // Il tasto Invio porta al passo successivo: la lega si crea solo all'ultimo passo.
    if (!nameOk) return;
    if (!last) {
      setStep(step + 1);
      return;
    }
    if (await onCreate(name, rules)) {
      setName("");
      setStep(0);
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
            legend="Formato"
            name="lg-format"
            value={rules.format}
            options={COMPETITION_FORMATS}
            onChange={(format) => setRules({
              ...rules,
              format,
              ranking: format === "h2h" ? "head_to_head" : "sum",
              phases: defaultPhases(format),
            })}
          />
        </>
      ) : null}
      {step === 1 ? (
        <>
          <Switch label="Modificatore difesa" checked={rules.defenseEnabled} onChange={(defenseEnabled) => setRules({ ...rules, defenseEnabled })} />
          <div className="lg-bonus">
            {BONUS_FIELDS.map((field) => (
              <Stepper
                key={field.key}
                label={field.label}
                step={0.5}
                value={rules.bonusMalus[field.key]}
                onChange={(value) => setRules({ ...rules, bonusMalus: { ...rules.bonusMalus, [field.key]: value } })}
              />
            ))}
          </div>
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
            onChange={(visibility) => setRules({ ...rules, visibility })}
          />
          <Choices<LeagueRules["enrollment"]>
            legend="Iscrizioni"
            name="lg-enrollment"
            value={rules.enrollment}
            options={[
              { id: "open", label: "Aperta", detail: "Con ingresso in media." },
              { id: "closed", label: "Numero chiuso", detail: "Decidi quanti posti ci sono." },
            ]}
            onChange={(enrollment) => setRules({
              ...rules,
              enrollment,
              maxMembers: enrollment === "closed" ? (rules.maxMembers ?? 8) : null,
            })}
          />
          {rules.enrollment === "closed" ? (
            <Stepper label="Posti" step={1} min={2} value={rules.maxMembers ?? 8} onChange={(maxMembers) => setRules({ ...rules, maxMembers })} />
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
            onChange={(exclusiveRosters) => setRules({ ...rules, exclusiveRosters })}
          />
          <Choices<LeagueRules["postponement"]>
            legend="Partite rinviate"
            name="lg-postponement"
            value={rules.postponement}
            options={[
              { id: "wait_recovery", label: "Attendi il recupero reale" },
              { id: "political_six", label: "Assegna 6 politico" },
            ]}
            onChange={(postponement) => setRules({ ...rules, postponement })}
          />
          <p className="lg-hint">Le regole restano sulla lega e il calcolo le legge da lì.</p>
        </>
      ) : null}
      <div className="lg-actions">
        {step > 0 ? (
          <button key="back" className="ghost" type="button" onClick={() => setStep(step - 1)}>Indietro</button>
        ) : null}
        {/* Chiavi diverse: «Avanti» non deve trasformarsi nel tasto di invio mentre lo si tocca. */}
        {last ? (
          <button key="create" className="primary" type="submit" disabled={pending || !nameOk} aria-busy={pending}>
            <BusyLabel pending={pending} idle="Crea lega" busy="Creazione..." />
          </button>
        ) : (
          <button key="next" className="primary" type="button" disabled={!nameOk} onClick={() => setStep(step + 1)}>
            Avanti
          </button>
        )}
      </div>
    </form>
  );
}
