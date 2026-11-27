// Avvisi automatici: testi predefiniti e descrizioni per il pannello admin. Usato da server e browser.

export type NotificationKind = "deadline" | "bonus" | "overtake";
export type NotificationText = { title: string; body: string; enabled: boolean };
export type NotificationTemplate = NotificationText & { kind: NotificationKind };

export const NOTIFICATION_KINDS: NotificationKind[] = ["deadline", "bonus", "overtake"];
/** Avvisi mostrati in «Avvisi automatici». La formazione ha il suo riquadro «Promemoria formazioni». */
export const EDITABLE_KINDS: NotificationKind[] = ["bonus", "overtake"];

export const DEFAULT_NOTIFICATION_TEXTS: Record<NotificationKind, NotificationText> = {
  deadline: {
    title: "Chiudi la formazione",
    body: "Mancano 30 minuti alla giornata {matchday}. Se non la invii, resta l'ultima schierata.",
    enabled: true,
  },
  bonus: { title: "Bonus in campo", body: "{player}: {event}.", enabled: true },
  overtake: { title: "Sorpasso live", body: "{opponent} ti ha superato. Giornata {matchday}.", enabled: true },
};

/** Come appare ogni avviso nel pannello: nome, quando parte, parole che si riempiono da sole. */
export const NOTIFICATION_INFO: Record<NotificationKind, { label: string; when: string; words: [string, string][] }> = {
  deadline: {
    label: "Formazione da inviare",
    when: "30 minuti prima della chiusura, a chi non ha ancora schierato.",
    words: [["{matchday}", "numero della giornata"]],
  },
  bonus: {
    label: "Bonus dei tuoi giocatori",
    when: "Durante le partite, quando un tuo titolare segna, fa assist o para un rigore.",
    words: [["{player}", "nome del calciatore"], ["{event}", "gol, assist o rigore parato"], ["{matchday}", "numero della giornata"]],
  },
  overtake: {
    label: "Sorpasso in classifica",
    when: "Durante la giornata, quando un'altra squadra della lega ti supera nella classifica live.",
    words: [["{opponent}", "squadra che ti ha superato"], ["{matchday}", "numero della giornata"]],
  },
};

/** Unisce i testi salvati con quelli predefiniti: il pannello mostra sempre tutti e tre gli avvisi. */
export function completeTemplates(saved: { kind: string; title: string; body: string; enabled: boolean }[]): NotificationTemplate[] {
  return NOTIFICATION_KINDS.map((kind) => {
    const row = saved.find((item) => item.kind === kind);
    return row
      ? { kind, title: row.title, body: row.body, enabled: Boolean(row.enabled) }
      : { kind, ...DEFAULT_NOTIFICATION_TEXTS[kind] };
  });
}
