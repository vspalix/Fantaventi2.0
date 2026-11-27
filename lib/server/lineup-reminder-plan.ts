// Quando mandare il promemoria delle formazioni. Funzioni pure: nessun database, nessuna rete.
// Il promemoria parte solo quando suona la sveglia esterna, quindi il momento si sceglie
// tra i suoi orari: il primo entro mezz'ora dall'anticipo voluto, altrimenti l'ultimo prima.
import { romeParts, romeTime } from "@/lib/server/vote-schedule";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Anticipo di partenza: 3 ore prima della chiusura. */
export const DEFAULT_LEAD_MINUTES = 180;
export const MIN_LEAD_MINUTES = 30;
export const MAX_LEAD_MINUTES = 48 * 60;
/** Ultimo momento utile: dopo, la formazione chiude troppo presto per servire. Mai dopo la chiusura. */
export const LAST_CALL_MINUTES = 5;
/** Se la sveglia suona poco dopo l'anticipo voluto si aspetta lei, altrimenti si anticipa. */
const LATE_TOLERANCE = 30 * MINUTE;
/** La sveglia può arrivare qualche secondo prima del minuto esatto. */
const EARLY = MINUTE;

// Orari della sveglia esterna (Europe/Rome). Se cambiano in .cursorrules, vanno aggiornati anche qui.
const MORNING = { hours: [8], minutes: [0, 30] };
const MATCHES = { hours: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], minutes: [0, 5, 15, 20, 30, 35, 45, 50] };

function nextDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** Orari della sveglia tra from e to compresi, in millisecondi. */
export function wakeTimes(from: number, to: number) {
  const times: number[] = [];
  let date = romeParts(from - 24 * HOUR).date;
  const last = romeParts(to + 24 * HOUR).date;
  while (date <= last) {
    for (const band of [MORNING, MATCHES]) {
      for (const hour of band.hours) {
        for (const minute of band.minutes) {
          const time = romeTime(date, hour, minute);
          if (time >= from && time <= to) times.push(time);
        }
      }
    }
    date = nextDate(date);
  }
  return [...new Set(times)].sort((left, right) => left - right);
}

export function clampLead(minutes: number) {
  if (!Number.isFinite(minutes)) return DEFAULT_LEAD_MINUTES;
  return Math.min(MAX_LEAD_MINUTES, Math.max(MIN_LEAD_MINUTES, Math.round(minutes)));
}

/** Il momento previsto per il promemoria di una chiusura. */
export function reminderMoment(deadline: number, leadMinutes: number) {
  const target = deadline - clampLead(leadMinutes) * MINUTE;
  const latest = deadline - LAST_CALL_MINUTES * MINUTE;
  const soonAfter = wakeTimes(target, Math.min(target + LATE_TOLERANCE, latest));
  if (soonAfter.length > 0) return soonAfter[0];
  const before = wakeTimes(target - 36 * HOUR, Math.min(target, latest));
  if (before.length > 0) return before[before.length - 1];
  return Math.min(target, latest);
}

export type ReminderVerdict =
  | { due: true; moment: number; late: boolean }
  | { due: false; moment: number; reason: "early" | "closed" };

/**
 * Va mandato adesso? Sì dal momento previsto fino a pochi minuti prima della chiusura.
 * Una sveglia persa si recupera alla chiamata successiva, mai dopo la chiusura.
 */
export function reminderVerdict(now: number, deadline: number, leadMinutes: number): ReminderVerdict {
  const moment = reminderMoment(deadline, leadMinutes);
  if (now > deadline - LAST_CALL_MINUTES * MINUTE) return { due: false, moment, reason: "closed" };
  if (now < moment - EARLY) return { due: false, moment, reason: "early" };
  return { due: true, moment, late: now > moment + 15 * MINUTE };
}

/** Fin dove guardare le giornate: oltre, nessuna può avere il promemoria in arrivo. */
export function lookAheadMinutes(leadMinutes: number) {
  return clampLead(leadMinutes) + 10 * 60;
}

const dayFormat = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" });
const clockFormat = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

/** «oggi alle 14:59», «domani alle 12:29», «sabato 5 dicembre alle 15:00». */
export function closingWords(deadline: number, now: number) {
  const clock = clockFormat.format(new Date(deadline));
  const day = romeParts(deadline).date;
  const today = romeParts(now).date;
  if (day === today) return `oggi alle ${clock}`;
  if (day === nextDate(today)) return `domani alle ${clock}`;
  return `${dayFormat.format(new Date(deadline))} alle ${clock}`;
}

export function reminderText(gameweek: number, deadline: number, now: number) {
  return {
    title: "Formazione da consegnare",
    body: `Giornata ${gameweek}: non hai ancora schierato la formazione. Chiude ${closingWords(deadline, now)}.`,
    url: "/leghe",
  };
}
