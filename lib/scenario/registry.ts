export type ScenarioActionSpec = {
  action: string;
  group: string;
  detail: string;
};

export const SCENARIO_ACTIONS: ScenarioActionSpec[] = [
  { action: "CREATE_USER", group: "Utenti", detail: "Crea un utente di scenario e lo registra con un alias." },
  { action: "LOGIN", group: "Utenti", detail: "Verifica che l'utente esista e lo imposta come attore." },
  { action: "SET_ROLE", group: "Utenti", detail: "Imposta platform_role su un utente di scenario." },
  { action: "IMPERSONATE", group: "Utenti", detail: "Le azioni successive partono da questo alias." },
  { action: "REMOVE_MEMBER", group: "Utenti", detail: "Toglie l'utente dalla lega." },
  { action: "CREATE_LEAGUE", group: "Leghe", detail: "Crea una lega classic, h2h o hybrid con le regole indicate." },
  { action: "JOIN_LEAGUE", group: "Leghe", detail: "Iscrive l'utente con il codice della lega di scenario." },
  { action: "SET_RULES", group: "Leghe", detail: "Cambia formato, soglie, modificatori, panchina dimenticata e rinvii." },
  { action: "SET_CHECKPOINTS", group: "Leghe", detail: "Sostituisce i checkpoint di mercato della lega." },
  { action: "GRANT_DELEGATE", group: "Leghe", detail: "Nomina un admin delegato tra i partecipanti." },
  { action: "REVOKE_DELEGATE", group: "Leghe", detail: "Revoca un admin delegato." },
  { action: "ASSIGN_ROSTER", group: "Rose", detail: "Assegna una rosa valida, un calciatore per club." },
  { action: "TRADE", group: "Rose", detail: "Scambia un calciatore tra due rose. Senza approvazione resta in sospeso." },
  { action: "APPROVE_TRADE", group: "Rose", detail: "Applica uno scambio sospeso se entrambe le rose restano valide." },
  { action: "REJECT_TRADE", group: "Rose", detail: "Annulla uno scambio sospeso." },
  { action: "SUBMIT_LINEUP", group: "Formazioni", detail: "Invia la formazione. repeat > 1 lancia invii simultanei." },
  { action: "SKIP_LINEUP", group: "Formazioni", detail: "Non invia: il calcolo userà la precedente o l'ordine alfabetico." },
  { action: "SET_DEADLINE", group: "Formazioni", detail: "Sposta la deadline della giornata di scenario: future, past o una data." },
  { action: "FILE_FORGOTTEN", group: "Formazioni", detail: "Applica il fallback d'ufficio alle squadre senza formazione." },
  { action: "CREATE_MATCH", group: "Voti", detail: "Crea una partita sulla giornata di scenario." },
  { action: "LOAD_VOTES", group: "Voti", detail: "Carica voti da elenco o da CSV di emergenza, senza calcolare da solo." },
  { action: "LIVE_SCORE", group: "Voti", detail: "Scrive la proiezione live, senza sostituzioni né totale ufficiale." },
  { action: "SCORE", group: "Voti", detail: "Calcola la giornata. Con times 2 verifica che il secondo passaggio abbia delta 0." },
  { action: "POSTPONE_MATCH", group: "Voti", detail: "Segna o toglie il rinvio di una partita di scenario." },
  { action: "RECALC", group: "Voti", detail: "Ricalcolo straordinario della giornata di scenario già calcolata." },
  { action: "ASSERT_SCORE", group: "Controlli", detail: "Il totale della squadra in quella giornata è il numero atteso." },
  { action: "ASSERT_RANKING", group: "Controlli", detail: "L'ordine di classifica della lega è quello indicato." },
  { action: "ASSERT_ERROR", group: "Controlli", detail: "L'ultimo errore contiene il testo atteso." },
  { action: "ASSERT_CONSTRAINT", group: "Controlli", detail: "La rosa rispetta, o viola, il vincolo di listone." },
  { action: "ASSERT_LINEUP_COUNT", group: "Controlli", detail: "Quante formazioni e quanti slot esistono per quella squadra." },
];

const KNOWN = new Set(SCENARIO_ACTIONS.map((spec) => spec.action));

export function isScenarioAction(action: string) {
  return KNOWN.has(action);
}
