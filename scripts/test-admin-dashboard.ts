// La Dashboard admin: quali problemi segnala e come conta le persone. Solo calcoli, con dati inventati.
import { pathToFileURL } from "node:url";
import { activeAdminTab, ADMIN_TABS, LEAGUE_PAGES } from "../lib/admin-area";
import { findProblems, matchProgress, summarizePeople, type DashboardRead, type ProblemInput } from "../lib/admin-dashboard";

type Case = { name: string; pass: boolean; detail: string };

const NOW = Date.parse("2026-11-28T11:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();
const ahead = (hours: number) => new Date(NOW + hours * HOUR).toISOString();

const read = (key: string, kind: string, outcome: string, hours: number, weekId: string | null = "w13"): DashboardRead => ({ key, kind, outcome, startedAt: ago(hours), weekId });

const calm: ProblemInput = {
  now: NOW,
  maintenance: false,
  autoReads: true,
  week: { id: "w13", number: 13, status: "open", deadlineAt: ahead(72), },
  matches: [{ status: "scheduled", kickoffAt: ahead(74), held: false }],
  reads: [read("cal:today", "calendar", "ok", 3, null)],
  lastReadAt: ago(3),
  availability: { manual: false, lastSyncAt: ago(5), unmatched: 0 },
  missingLineups: 4,
};

export function runAdminDashboardChecks() {
  const cases: Case[] = [];
  const add = (name: string, pass: boolean, detail = "") => cases.push({ name, pass, detail });
  const ids = (patch: Partial<ProblemInput>) => findProblems({ ...calm, ...patch }).map((problem) => problem.id).join(",");
  const expect = (name: string, patch: Partial<ProblemInput>, wanted: string) => add(name, ids(patch) === wanted, ids(patch) || "nessuno");

  expect("Tutto regolare: nessun avviso, anche con formazioni mancanti lontano dalla scadenza", {}, "");
  expect("Manutenzione accesa", { maintenance: true }, "maintenance");
  expect("Letture automatiche spente", { autoReads: false, lastReadAt: ago(90) }, "auto-off");
  expect("Sveglie ferme oltre 28 ore", { lastReadAt: ago(29), reads: [] }, "silent");
  expect("Lettura di 27 ore fa: ancora regolare", { lastReadAt: ago(27) }, "");
  expect("Lettura dei voti fallita", { reads: [read("v1", "fulltime", "error", 2)] }, "read-votes");
  expect("Fallita ma poi riuscita al secondo tentativo", { reads: [read("v1", "fulltime", "ok", 1), read("v1", "fulltime", "error", 2)] }, "");
  expect("Intervallo fallito, voti letti dopo: risolto", { reads: [read("v2", "morning", "ok", 1), read("v1", "halftime", "error", 12)] }, "");
  expect("Una lettura riuscita di un'altra giornata non basta", { reads: [read("v2", "morning", "ok", 1, "w12"), read("v1", "fulltime", "error", 2)] }, "read-votes");
  expect("Calendario e calcolo falliti", { reads: [read("cal:today", "calendar", "alert", 2, null), read("calc:w13", "calc", "error", 1)] }, "read-calendar,read-calc");
  expect("Voti non ancora pronti non è un guasto", { reads: [read("v1", "fulltime", "not_ready", 1)] }, "");

  const finished = [{ status: "finished", kickoffAt: ago(30), held: false }];
  expect("Partite finite da un giorno e giornata non calcolata", { week: { id: "w13", number: 13, status: "locked", deadlineAt: ago(80) }, matches: finished }, "to-calculate");
  expect("Giornata calcolata: nessun avviso", { week: { id: "w13", number: 13, status: "scored", deadlineAt: ago(80) }, matches: finished }, "");
  expect(
    "Turno finito da un giorno con una partita senza voti ufficiali, più una rinviata",
    { week: { id: "w13", number: 13, status: "locked", deadlineAt: ago(40) }, matches: [{ status: "locked", kickoffAt: ago(30), held: false }, { status: "scheduled", kickoffAt: ago(6), held: true }] },
    "stuck,held",
  );
  expect(
    "Nel fine settimana le partite non ancora ufficiali sono normali",
    { week: { id: "w13", number: 13, status: "locked", deadlineAt: ago(16) }, matches: [{ status: "locked", kickoffAt: ago(15), held: false }, { status: "scheduled", kickoffAt: ahead(30), held: false }] },
    "",
  );
  const progress = matchProgress([
    { status: "locked", kickoffAt: ago(15), held: false },
    { status: "scheduled", kickoffAt: ago(1), held: false },
    { status: "scheduled", kickoffAt: ahead(3), held: false },
    { status: "scheduled", kickoffAt: ago(15), held: true },
    { status: "finished", kickoffAt: ago(1), held: false },
  ], NOW);
  add("Partite giocate e in corso dall'orario", progress.total === 5 && progress.played === 2 && progress.live === 1, JSON.stringify(progress));
  expect("Formazioni mancanti a meno di un giorno dalla scadenza", { week: { id: "w13", number: 13, status: "open", deadlineAt: ahead(5) } }, "lineups");
  expect("Dopo la scadenza non si segnala più chi manca", { week: { id: "w13", number: 13, status: "locked", deadlineAt: ago(1) } }, "");
  expect("Indisponibili vecchi e da abbinare", { availability: { manual: false, lastSyncAt: ago(40), unmatched: 2 } }, "injuries-stale,injuries-unmatched");
  expect("Indisponibili manuali: l'età non conta", { availability: { manual: true, lastSyncAt: ago(400), unmatched: 0 } }, "");
  expect("I guasti vengono prima delle cose da tenere d'occhio", { maintenance: true, availability: { manual: false, lastSyncAt: ago(1), unmatched: 1 }, autoReads: false }, "maintenance,auto-off,injuries-unmatched");
  const soon = findProblems({ ...calm, week: { id: "w13", number: 13, status: "open", deadlineAt: ahead(0.5) }, missingLineups: 1 })[0];
  add("Testi al singolare", soon?.title === "1 squadra senza formazione" && soon.detail === "Si chiude tra meno di un'ora.", `${soon?.title} / ${soon?.detail}`);

  const account = (id: string, days: number, email = `${id}@esempio.it`) => ({ id, email, createdAt: ago(days * 24) });
  const people = summarizePeople(
    [account("a", 1), account("b", 10), account("c", 200), account("t", 1, "tester1@fantaventi.test")],
    ["a", "a", "t"],
    ["a", "b", "b"],
    ["a", "c", "t"],
    NOW,
  );
  add("Gli account di prova non sono persone", people.users === 3 && people.testUsers === 1, JSON.stringify(people));
  add("Nuovi della settimana e per settimana", people.newThisWeek === 1 && people.weekly.join() === "0,0,0,0,0,0,1,1", people.weekly.join());
  add("Ogni persona conta una volta", people.playing === 1 && people.withPush === 2 && people.withoutLeague === 1, JSON.stringify(people));

  add("Barra: cinque voci", ADMIN_TABS.map((tab) => tab.label).join() === "Dashboard,Giornata,Utenti,Notifiche,Menu");
  add(
    "Barra: ogni pagina accende la sua voce",
    activeAdminTab("/admin") === "/admin" && activeAdminTab("/admin/import-voti") === "/admin/giornata" && activeAdminTab("/admin/sponsor") === "/admin/notifiche" && activeAdminTab("/admin/formazioni") === "/admin/menu",
  );
  add("Selettore della lega solo nelle sezioni di lega", LEAGUE_PAGES.join() === "/admin/formazioni,/admin/leghe,/admin/rules-editor", LEAGUE_PAGES.join());

  const failures = cases.filter((item) => !item.pass).map((item) => `${item.name}: ${item.detail}`);
  return { passed: cases.length - failures.length, total: cases.length, failures, cases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAdminDashboardChecks();
  for (const failure of result.failures) console.log(`- ${failure}`);
  console.log(`Dashboard admin: ${result.passed}/${result.total}`);
  if (result.failures.length > 0) process.exit(1);
}
