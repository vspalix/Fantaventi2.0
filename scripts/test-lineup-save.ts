// Salvataggi quasi contemporanei della stessa formazione: nuovi tentativi solo sui blocchi del
// database, nessun aggiornamento a parte dopo submit_lineup, SQL con i controlli dopo il blocco.
// Solo dati inventati: nessun database e nessuna rete. La prova vera di concorrenza si fa su un
// Postgres locale (vedi il file SQL in supabase/migrations).
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LINEUP_LOCK_CODES, submitLineupSerialized } from "../lib/server/lineup-submit";

type Reply = { error: { code?: string; message: string } | null };

/** Finto database: risponde in ordine con le risposte date e conta le chiamate. */
function fakeDb(replies: Reply[]) {
  const calls: string[] = [];
  return {
    calls,
    rpc(fn: string) {
      calls.push(fn);
      return Promise.resolve(replies[Math.min(calls.length - 1, replies.length - 1)]);
    },
  };
}

const DEADLOCK: Reply = { error: { code: "40P01", message: "deadlock detected" } };
const LATE: Reply = { error: { code: "23514", message: "La deadline della giornata 13 è scaduta." } };
const OK: Reply = { error: null };

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

export async function runLineupSaveChecks() {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };
  const quick = [0, 0];

  let db = fakeDb([OK]);
  let error = await submitLineupSerialized(db, {}, quick);
  check("Salvataggio senza blocchi: una sola chiamata", error === null && db.calls.length === 1, `${db.calls.length}`);

  db = fakeDb([DEADLOCK, OK]);
  error = await submitLineupSerialized(db, {}, quick);
  check("Stallo con un altro salvataggio: riprova e salva", error === null && db.calls.length === 2, `${db.calls.length}`);

  db = fakeDb([DEADLOCK, DEADLOCK, DEADLOCK, OK]);
  error = await submitLineupSerialized(db, {}, quick);
  check("Al massimo due nuovi tentativi", error?.code === "40P01" && db.calls.length === 3, `${db.calls.length}`);

  db = fakeDb([DEADLOCK, LATE]);
  error = await submitLineupSerialized(db, {}, quick);
  check(
    "Il nuovo tentativo dopo l'orario di inizio resta rifiutato",
    error?.code === "23514" && db.calls.length === 2,
    `${error?.message} ${db.calls.length}`,
  );

  db = fakeDb([LATE, OK]);
  error = await submitLineupSerialized(db, {}, quick);
  check("Gli errori che non sono blocchi non si ripetono", error?.code === "23514" && db.calls.length === 1, `${db.calls.length}`);

  check(
    "Codici di blocco: stallo, conflitto, attesa",
    ["40P01", "40001", "55P03"].every((code) => LINEUP_LOCK_CODES.has(code)) && !LINEUP_LOCK_CODES.has("23514"),
  );

  const hub = read("lib/server/league-hub.ts");
  const save = hub.slice(hub.indexOf("export async function saveLeagueLineup"));
  check(
    "Dopo submit_lineup nessun aggiornamento a parte della formazione",
    !/\.from\("lineups"\)\s*\.update\(/.test(save) && save.includes("submitLineupSerialized("),
  );

  const lockMessage = "Un altro salvataggio della stessa formazione non era ancora finito. Riprova tra un attimo.";
  check(
    "Il messaggio sul blocco non sembra una giornata chiusa",
    save.includes(lockMessage) && !/scaduta|è chiusa|in corso|bloccata/i.test(lockMessage),
  );

  const screen = read("components/leagues/LeagueHub.tsx");
  check(
    "In schermata un invio superato da uno più recente non parte",
    /saveQueue\.current = saveQueue\.current\.then\(async \(\) => \{\s*(\/\/[^\n]*\n\s*)*if \(lastSent\.current !== body\) return;/.test(screen),
  );
  check("Lo schieramento di test aspetta gli invii in coda", /const sending = saveQueue\.current\.then\(/.test(screen));

  const sql = read("supabase/migrations/20261127120000_salvataggio_formazione_concorrente.sql");
  const lockAt = sql.indexOf("for update;", sql.indexOf("create or replace function public.submit_lineup"));
  const recheckAt = sql.indexOf("select g.status, g.deadline_at", lockAt);
  check("SQL: stato e orario riletti dopo il blocco della squadra", lockAt > 0 && recheckAt > lockAt);
  check("SQL: orario confrontato con l'ora vera", !/now\(\) >= v_deadline/.test(sql) && (sql.match(/clock_timestamp\(\) >= v_deadline/g) ?? []).length === 2);
  check("SQL: controllo finale prima di confermare", sql.lastIndexOf("clock_timestamp() >= v_deadline") < sql.lastIndexOf("return v_lineup_id;"));
  check(
    "SQL: il trigger non blocca la squadra quando si aggiorna la stessa formazione",
    /tg_op = 'UPDATE' and new\.fantasy_team_id is not distinct from old\.fantasy_team_id/.test(sql),
  );
  check("SQL: tutto in una transazione", /^begin;$/m.test(sql) && /^commit;$/m.test(sql));

  return { total, passed: total - failures.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runLineupSaveChecks().then((result) => {
    console.log(`Salvataggi contemporanei: ${result.passed}/${result.total}`);
    for (const failure of result.failures) console.log(`- ${failure}`);
    if (result.failures.length > 0) process.exit(1);
  });
}
