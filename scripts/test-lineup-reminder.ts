// Promemoria formazioni con orologio finto, database finto in memoria e invii finti. Nessuna rete.
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  liveDeps,
  reminderKey,
  runLineupReminder,
  settingsFromRow,
  type PendingTeam,
  type ReminderDeps,
  type ReminderSettings,
  type ReminderWeek,
  type SentSummary,
} from "@/lib/server/lineup-reminder";
import { clampLead, reminderMoment, reminderVerdict, wakeTimes } from "@/lib/server/lineup-reminder-plan";
import { romeParts, romeTime } from "@/lib/server/vote-schedule";
import type { PushPayload } from "@/lib/server/web-push";

type Case = { name: string; pass: boolean; detail: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Sveglia esterna scritta a mano, come in .cursorrules: non si usa la funzione da provare.
const MATCH_MINUTES = [0, 5, 15, 20, 30, 35, 45, 50];

const at = (date: string, clock: string) => {
  const [hour, minute] = clock.split(":").map(Number);
  return romeTime(date, hour, minute);
};
const rome = (time: number) => {
  const parts = romeParts(time);
  return `${parts.date} ${String(Math.floor(parts.minutes / 60)).padStart(2, "0")}:${String(parts.minutes % 60).padStart(2, "0")}`;
};

function externalWakes(days: string[]) {
  const times: number[] = [];
  for (const day of days) {
    times.push(at(day, "08:00"), at(day, "08:30"));
    for (let hour = 13; hour <= 23; hour += 1) {
      for (const minute of MATCH_MINUTES) times.push(romeTime(day, hour, minute));
    }
  }
  return times.sort((left, right) => left - right);
}

/** GitHub ogni 15 minuti, in ritardo di qualche minuto come succede davvero. */
function githubWakes(from: number, to: number, delay = 7 * MINUTE) {
  const times: number[] = [];
  const start = Math.ceil(from / (15 * MINUTE)) * 15 * MINUTE;
  for (let time = start; time <= to; time += 15 * MINUTE) times.push(time + delay);
  return times;
}

type World = {
  settings: ReminderSettings;
  maintenance: boolean;
  weeks: ReminderWeek[];
  blocked: string | null;
  teams: PendingTeam[];
  filed: Set<string>;
  claimed: Set<string>;
  sends: { at: number; userIds: string[]; payload: PushPayload; expiresAt: number }[];
  records: SentSummary[];
  devices: Map<string, number>;
};

function world(deadline: number, extra: Partial<World> = {}): World {
  return {
    settings: { enabled: true, leadMinutes: 180, ready: true },
    maintenance: false,
    weeks: [{ id: "w13", number: 13, seasonId: "s1", status: "open", deadlineAt: deadline }],
    blocked: null,
    teams: [
      { teamId: "t1", userId: "u1" },
      { teamId: "t2", userId: "u2" },
      { teamId: "t3", userId: "u3" },
      { teamId: "t4", userId: "u4" },
      { teamId: "t5", userId: "u5" },
    ],
    filed: new Set(["t4", "t5"]),
    claimed: new Set(),
    sends: [],
    records: [],
    devices: new Map([["u1", 2], ["u2", 1]]),
    ...extra,
  };
}

function fakeDeps(state: World, clock: { now: number }): ReminderDeps {
  return {
    settings: async () => state.settings,
    maintenance: async () => state.maintenance,
    upcomingWeeks: async (now, until) => state.weeks.filter((week) => week.deadlineAt > now && week.deadlineAt <= until),
    blocked: async () => state.blocked,
    pendingTeams: async () => state.teams.filter((team) => !state.filed.has(team.teamId)),
    claim: async (key) => {
      if (state.claimed.has(key)) return false;
      state.claimed.add(key);
      return true;
    },
    send: async (userIds, payload, expiresAt) => {
      state.sends.push({ at: clock.now, userIds, payload, expiresAt });
      const reached = userIds.filter((id) => (state.devices.get(id) ?? 0) > 0);
      return { sent: reached.reduce((sum, id) => sum + (state.devices.get(id) ?? 0), 0), people: reached.length };
    },
    record: async (summary) => {
      state.records.push(summary);
    },
  };
}

async function play(state: World, calls: number[], hooks: Map<number, () => void> = new Map()) {
  const clock = { now: 0 };
  const deps = fakeDeps(state, clock);
  for (const time of [...new Set(calls)].sort((left, right) => left - right)) {
    for (const [hookAt, hook] of hooks) {
      if (hookAt <= time) {
        hook();
        hooks.delete(hookAt);
      }
    }
    clock.now = time;
    await runLineupReminder(time, deps);
  }
  return state;
}

const DAYS = ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"];

function planCases(): Case[] {
  const cases: Case[] = [];
  const moment = (name: string, deadline: number, lead: number, expected: number) => {
    const got = reminderMoment(deadline, lead);
    cases.push({ name, pass: got === expected, detail: `atteso ${rome(expected)}, calcolato ${rome(got)}` });
  };
  moment("Chiusura 18:29: promemoria alle 15:30", at("2026-11-27", "18:29"), 180, at("2026-11-27", "15:30"));
  moment("Chiusura 20:44: promemoria alle 17:45", at("2026-11-27", "20:44"), 180, at("2026-11-27", "17:45"));
  moment("Chiusura 14:59 (fuori fascia): si anticipa alle 08:30", at("2026-11-28", "14:59"), 180, at("2026-11-28", "08:30"));
  moment("Chiusura 12:29 (fuori fascia): si anticipa alle 08:30", at("2026-11-29", "12:29"), 180, at("2026-11-29", "08:30"));
  moment("Chiusura 09:59: l'ultima sveglia della sera prima", at("2026-11-29", "09:59"), 180, at("2026-11-28", "23:50"));
  moment("Anticipo di 1 ora con chiusura 14:59: alle 14:00", at("2026-11-28", "14:59"), 60, at("2026-11-28", "14:00"));
  moment("Anticipo di 24 ore con chiusura 20:44: il giorno prima alle 20:45", at("2026-11-28", "20:44"), 24 * 60, at("2026-11-27", "20:45"));
  moment("Ora legale (28/03/2027): chiusura 20:44, promemoria alle 17:45", at("2027-03-28", "20:44"), 180, at("2027-03-28", "17:45"));
  moment("Ritorno all'ora solare (31/10/2027): chiusura 14:59, alle 08:30", at("2027-10-31", "14:59"), 180, at("2027-10-31", "08:30"));

  const deadline = at("2026-11-28", "20:44");
  const planned = at("2026-11-28", "17:45");
  const verdict = (now: number) => reminderVerdict(now, deadline, 180);
  cases.push({ name: "Prima del momento: si aspetta", pass: verdict(planned - 2 * MINUTE).due === false, detail: JSON.stringify(verdict(planned - 2 * MINUTE)) });
  cases.push({ name: "Sveglia con 30 secondi di anticipo: parte", pass: verdict(planned - 30_000).due === true, detail: JSON.stringify(verdict(planned - 30_000)) });
  const recovered = verdict(deadline - 10 * MINUTE);
  cases.push({ name: "Sveglia persa: recupera 10 minuti prima della chiusura", pass: recovered.due === true && recovered.late === true, detail: JSON.stringify(recovered) });
  const tooLate = verdict(deadline - 4 * MINUTE);
  cases.push({ name: "Negli ultimi 5 minuti non parte più", pass: tooLate.due === false && tooLate.reason === "closed", detail: JSON.stringify(tooLate) });
  const after = verdict(deadline + MINUTE);
  cases.push({ name: "Dopo la chiusura non parte mai", pass: after.due === false, detail: JSON.stringify(after) });
  cases.push({ name: "Anticipo fuori misura riportato tra 30 minuti e 48 ore", pass: clampLead(0) === 30 && clampLead(10_000) === 2880 && clampLead(Number.NaN) === 180, detail: `${clampLead(0)} ${clampLead(10_000)} ${clampLead(Number.NaN)}` });
  const wakes = wakeTimes(at("2026-11-28", "00:00"), at("2026-11-28", "23:59"));
  cases.push({ name: "La sveglia ha 90 orari al giorno", pass: wakes.length === 90, detail: `${wakes.length}` });
  const unready = settingsFromRow({ id: 1, auto_sync_enabled: true });
  const ready = settingsFromRow({ lineup_reminder_enabled: true, lineup_reminder_lead_minutes: 120 });
  cases.push({ name: "Senza la modifica al database il promemoria resta fermo", pass: !unready.ready && !unready.enabled && ready.ready && ready.leadMinutes === 120, detail: `${JSON.stringify(unready)} ${JSON.stringify(ready)}` });
  return cases;
}

async function timelineCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const all = (from: string, to: string) => {
    const start = at(from, "00:00");
    const end = at(to, "23:59");
    return [...externalWakes(DAYS).filter((time) => time >= start && time <= end), ...githubWakes(start, end)];
  };

  {
    const deadline = at("2026-11-28", "14:59");
    const state = await play(world(deadline), all("2026-11-26", "2026-11-29"));
    const first = state.sends[0];
    cases.push({
      name: "Weekend intero: un solo invio, sabato alle 08:30, a 3 squadre",
      pass: state.sends.length === 1 && first?.at === at("2026-11-28", "08:30") && first.userIds.join(",") === "u1,u2,u3",
      detail: state.sends.map((send) => `${rome(send.at)} → ${send.userIds.join(",")}`).join(" | ") || "nessun invio",
    });
    cases.push({
      name: "Il testo dice giornata e chiusura; la notifica scade alla chiusura",
      pass: first?.payload.body === "Giornata 13: non hai ancora schierato la formazione. Chiude oggi alle 14:59." && first.expiresAt === deadline,
      detail: first?.payload.body ?? "",
    });
    cases.push({
      name: "Riepilogo: 3 squadre, 2 persone con notifiche, 3 dispositivi",
      pass: state.records.length === 1 && state.records[0].teams === 3 && state.records[0].people === 2 && state.records[0].devices === 3,
      detail: JSON.stringify(state.records),
    });
  }

  {
    const deadline = at("2026-11-28", "14:59");
    const calls = all("2026-11-26", "2026-11-29").filter((time) => time !== at("2026-11-28", "08:00") && time !== at("2026-11-28", "08:30"));
    const state = await play(world(deadline), calls);
    const sent = state.sends[0]?.at ?? 0;
    cases.push({
      name: "Sveglie 08:00 e 08:30 perse: recupera GitHub poco dopo",
      pass: state.sends.length === 1 && sent > at("2026-11-28", "08:30") && sent < at("2026-11-28", "09:00") && state.records[0]?.late === false,
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const deadline = at("2026-11-28", "14:59");
    const external = externalWakes(DAYS).filter((time) => time >= at("2026-11-26", "00:00") && time <= at("2026-11-29", "23:59"));
    const calls = external.filter((time) => time !== at("2026-11-28", "08:00") && time !== at("2026-11-28", "08:30"));
    const state = await play(world(deadline), calls);
    cases.push({
      name: "Mattina persa e GitHub fermo: recupera alle 13:00, prima della chiusura delle 14:59",
      pass: state.sends.length === 1 && state.sends[0].at === at("2026-11-28", "13:00") && state.records[0]?.late === true,
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const deadline = at("2026-11-28", "20:44");
    const calls = all("2026-11-26", "2026-11-29").filter((time) => time < at("2026-11-28", "17:45") || time > at("2026-11-28", "20:00"));
    const state = await play(world(deadline), calls);
    const sent = state.sends[0]?.at ?? 0;
    cases.push({
      name: "Sveglie perse dalle 17:45 alle 20:00: parte alla prima dopo, in ritardo",
      pass: state.sends.length === 1 && sent > at("2026-11-28", "20:00") && sent < deadline && state.records[0]?.late === true,
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const deadline = at("2026-11-28", "20:44");
    const calls = all("2026-11-26", "2026-11-29").filter((time) => time < at("2026-11-28", "17:45") || time > at("2026-11-28", "20:40"));
    const state = await play(world(deadline), calls);
    cases.push({
      name: "Tutte le sveglie perse fino agli ultimi 4 minuti: niente invio",
      pass: state.sends.length === 0,
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const state = world(at("2026-11-28", "14:59"));
    const hooks = new Map([[at("2026-11-27", "12:00"), () => { state.weeks[0].deadlineAt = at("2026-11-29", "20:44"); }]]);
    await play(state, all("2026-11-26", "2026-11-30"), hooks);
    cases.push({
      name: "Rinvio prima del promemoria: parte all'orario nuovo (domenica 17:45)",
      pass: state.sends.length === 1 && state.sends[0].at === at("2026-11-29", "17:45"),
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const state = world(at("2026-11-29", "20:44"));
    const hooks = new Map([[at("2026-11-28", "08:05"), () => { state.weeks[0].deadlineAt = at("2026-11-28", "11:59"); }]]);
    await play(state, all("2026-11-26", "2026-11-30"), hooks);
    const sent = state.sends[0]?.at ?? 0;
    cases.push({
      name: "Anticipo dopo le 08:00: il momento è già passato, parte alla chiamata dopo",
      pass: state.sends.length === 1 && sent >= at("2026-11-28", "08:05") && sent < at("2026-11-28", "08:31"),
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const state = world(at("2026-11-28", "20:44"));
    const hooks = new Map([[at("2026-11-28", "17:00"), () => { state.weeks[0].deadlineAt = at("2026-11-28", "17:01"); }]]);
    const calls = all("2026-11-26", "2026-11-30").filter((time) => time < at("2026-11-28", "16:58") || time > at("2026-11-28", "17:10"));
    await play(state, calls, hooks);
    cases.push({
      name: "Anticipo a chiusura già passata quando suona la sveglia: niente invio",
      pass: state.sends.length === 0,
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const state = world(at("2026-11-28", "20:44"));
    state.blocked = "La giornata 12 è ancora in corso.";
    const hooks = new Map([[at("2026-11-28", "18:10"), () => { state.blocked = null; }]]);
    await play(state, all("2026-11-26", "2026-11-30"), hooks);
    const sent = state.sends[0]?.at ?? 0;
    cases.push({
      name: "Giornata prima ancora in corso: aspetta e parte appena si può schierare",
      pass: state.sends.length === 1 && sent >= at("2026-11-28", "18:10") && sent <= at("2026-11-28", "18:16"),
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const state = world(at("2026-11-28", "20:44"));
    state.maintenance = true;
    const hooks = new Map([[at("2026-11-28", "19:00"), () => { state.maintenance = false; }]]);
    await play(state, all("2026-11-26", "2026-11-30"), hooks);
    cases.push({
      name: "Manutenzione: nessun invio finché è accesa, poi parte",
      pass: state.sends.length === 1 && state.sends[0].at >= at("2026-11-28", "19:00"),
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }

  {
    const state = world(at("2026-11-28", "20:44"));
    const hooks = new Map([[at("2026-11-28", "12:00"), () => { state.filed.add("t2"); }], [at("2026-11-28", "18:00"), () => { state.filed.add("t1"); }]]);
    await play(state, all("2026-11-26", "2026-11-30"), hooks);
    cases.push({
      name: "Chi consegna prima non lo riceve; chi consegna dopo non ne riceve un secondo",
      pass: state.sends.length === 1 && state.sends[0].userIds.join(",") === "u1,u3",
      detail: state.sends.map((send) => `${rome(send.at)} → ${send.userIds.join(",")}`).join(" | ") || "nessun invio",
    });
  }

  {
    const off = await play(world(at("2026-11-28", "20:44"), { settings: { enabled: false, leadMinutes: 180, ready: true } }), all("2026-11-26", "2026-11-30"));
    const missing = await play(world(at("2026-11-28", "20:44"), { settings: { enabled: true, leadMinutes: 180, ready: false } }), all("2026-11-26", "2026-11-30"));
    cases.push({
      name: "Interruttore spento o database non pronto: nessun invio",
      pass: off.sends.length === 0 && missing.sends.length === 0,
      detail: `${off.sends.length} ${missing.sends.length}`,
    });
  }

  {
    const state = world(at("2026-11-28", "20:44"));
    const clock = { now: at("2026-11-28", "17:45") };
    const deps = fakeDeps(state, clock);
    await Promise.all([runLineupReminder(clock.now, deps), runLineupReminder(clock.now + 1000, deps)]);
    cases.push({
      name: "Sveglia e GitHub insieme: un solo invio",
      pass: state.sends.length === 1 && state.claimed.size === 3,
      detail: `${state.sends.length} invii, ${state.claimed.size} chiavi`,
    });
  }

  {
    const state = world(at("2026-11-28", "20:44"), { settings: { enabled: true, leadMinutes: 24 * 60, ready: true } });
    await play(state, all("2026-11-26", "2026-11-30"));
    cases.push({
      name: "Anticipo cambiato a 24 ore: parte venerdì alle 20:45",
      pass: state.sends.length === 1 && state.sends[0].at === at("2026-11-27", "20:45"),
      detail: state.sends.map((send) => rome(send.at)).join(" | ") || "nessun invio",
    });
  }
  return cases;
}

// Database finto in memoria, con lo stesso modo di chiedere i dati della libreria Supabase.
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

function comparable(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).getTime();
  return value as number;
}

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private single = false;
  private action: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row[] = [];
  private patch: Row = {};

  constructor(private db: FakeDb, private table: string) {}

  select() { return this; }
  insert(rows: Row | Row[]) { this.action = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Row) { this.action = "update"; this.patch = patch; return this; }
  delete() { this.action = "delete"; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  gt(column: string, value: unknown) { this.filters.push((row) => comparable(row[column]) > comparable(value)); return this; }
  gte(column: string, value: unknown) { this.filters.push((row) => comparable(row[column]) >= comparable(value)); return this; }
  lt(column: string, value: unknown) { this.filters.push((row) => comparable(row[column]) < comparable(value)); return this; }
  lte(column: string, value: unknown) { this.filters.push((row) => comparable(row[column]) <= comparable(value)); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orderBy = { column, ascending: options?.ascending !== false }; return this; }
  limit(count: number) { this.max = count; return this; }
  maybeSingle() { this.single = true; return this; }

  private run() {
    this.db.calls.push(`${this.action} ${this.table}`);
    const rows = this.db.tables[this.table];
    if (!rows) return { data: null, error: { message: `relation "public.${this.table}" does not exist` } };
    if (this.action === "insert") {
      const key = this.db.unique[this.table];
      for (const row of this.payload) {
        if (key && rows.some((existing) => existing[key] === row[key])) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
      }
      rows.push(...this.payload.map((row) => ({ ...row })));
      return { data: this.single ? this.payload[0] : this.payload, error: null };
    }
    let found = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.action === "update") {
      for (const row of found) Object.assign(row, this.patch);
    }
    if (this.action === "delete") {
      this.db.tables[this.table] = rows.filter((row) => !found.includes(row));
    }
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      found = [...found].sort((left, right) => (comparable(left[column]) > comparable(right[column]) ? 1 : -1) * (ascending ? 1 : -1));
    }
    if (this.max !== null) found = found.slice(0, this.max);
    return { data: this.single ? found[0] ?? null : found, error: null };
  }

  then<A, B>(resolve?: ((value: { data: unknown; error: { message: string; code?: string } | null }) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

export class FakeDb {
  calls: string[] = [];
  unique: Record<string, string> = { engagement_notices: "dedupe_key" };
  constructor(public tables: Record<string, Row[]>) {}
  from(table: string) { return new FakeQuery(this, table); }
}

export function seasonData() {
  const deadline = at("2026-11-28", "14:59");
  return new FakeDb({
    system_settings: [{ id: 1, auto_sync_enabled: true, lineup_reminder_enabled: true, lineup_reminder_lead_minutes: 180 }],
    gameweeks: [
      { id: "g12", number: 12, season_id: "s1", status: "scored", deadline_at: new Date(at("2026-11-21", "14:59")).toISOString() },
      { id: "g13", number: 13, season_id: "s1", status: "open", deadline_at: new Date(deadline).toISOString() },
      { id: "g14", number: 14, season_id: "s1", status: "scheduled", deadline_at: new Date(at("2026-12-05", "14:59")).toISOString() },
    ],
    real_matches: [
      { gameweek_id: "g12", kickoff_at: new Date(at("2026-11-21", "15:00")).toISOString(), status: "finished" },
      { gameweek_id: "g13", kickoff_at: new Date(deadline + MINUTE).toISOString(), status: "scheduled" },
      { gameweek_id: "g14", kickoff_at: new Date(at("2026-12-05", "15:00")).toISOString(), status: "scheduled" },
    ],
    private_leagues: [
      { id: "L1", season_id: "s1", start_matchday: 1, end_matchday: 38, is_sandbox: false },
      { id: "L2", season_id: "s1", start_matchday: 15, end_matchday: 38, is_sandbox: false },
      { id: "LS", season_id: "s1", start_matchday: 1, end_matchday: 38, is_sandbox: true },
    ],
    private_league_members: [
      { private_league_id: "L1", fantasy_team_id: "t1" },
      { private_league_id: "L1", fantasy_team_id: "t2" },
      { private_league_id: "L1", fantasy_team_id: "t3" },
      { private_league_id: "L2", fantasy_team_id: "t6" },
      { private_league_id: "LS", fantasy_team_id: "t7" },
    ],
    fantasy_teams: [
      { id: "t1", user_id: "u1" },
      { id: "t2", user_id: "u2" },
      { id: "t3", user_id: "u3" },
      { id: "t6", user_id: "u6" },
      { id: "t7", user_id: "u7" },
    ],
    lineups: [{ fantasy_team_id: "t3", gameweek_id: "g13" }],
    engagement_notices: [],
    push_subscriptions: [
      { endpoint: "https://push.example.test/a", user_id: "u1", p256dh: "x", auth_secret: "y" },
    ],
  });
}

async function databaseCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const now = at("2026-11-28", "08:30");
  const db = seasonData();
  const admin = db as unknown as SupabaseClient;
  const sent: { userIds: string[]; payload: PushPayload }[] = [];
  const records: SentSummary[] = [];
  const deps: ReminderDeps = {
    ...liveDeps(admin, async (userIds, payload) => {
      sent.push({ userIds, payload });
      return { sent: 1, skipped: 0, people: 1 };
    }),
    maintenance: async () => false,
    record: async (summary) => { records.push(summary); },
  };

  const early = await runLineupReminder(at("2026-11-28", "08:00"), deps);
  cases.push({
    name: "Dati finti alle 08:00: la giornata 13 aspetta le 08:30",
    pass: sent.length === 0 && early.weeks[0]?.state === "waiting" && early.weeks[0]?.gameweek === 13,
    detail: JSON.stringify(early),
  });

  const report = await runLineupReminder(now, deps);
  const users = sent[0]?.userIds.join(",") ?? "";
  cases.push({
    name: "Dati finti alle 08:30: avvisati solo u1 e u2 (u3 ha consegnato, lega L2 parte dalla 15, lega di prova esclusa)",
    pass: sent.length === 1 && users === "u1,u2",
    detail: `${users} | ${JSON.stringify(report)}`,
  });
  const keys = (db.tables.engagement_notices ?? []).map((row) => row.dedupe_key).sort();
  cases.push({
    name: "Ricordato in engagement_notices per squadra e giornata",
    pass: JSON.stringify(keys) === JSON.stringify([reminderKey("g13", "t1"), reminderKey("g13", "t2")]),
    detail: JSON.stringify(keys),
  });

  await runLineupReminder(now + 5 * MINUTE, deps);
  await runLineupReminder(now + 4 * HOUR, deps);
  cases.push({ name: "Chiamate dopo: nessun secondo invio", pass: sent.length === 1, detail: `${sent.length} invii` });

  const stuckDb = seasonData();
  stuckDb.tables.gameweeks[0].status = "locked";
  stuckDb.tables.real_matches[0].status = "live";
  const stuckSent: string[][] = [];
  const stuck = await runLineupReminder(now, {
    ...liveDeps(stuckDb as unknown as SupabaseClient, async (userIds) => {
      stuckSent.push(userIds);
      return { sent: 0, skipped: 0, people: 0 };
    }),
    maintenance: async () => false,
    record: async () => undefined,
  });
  cases.push({
    name: "Giornata 12 ancora in corso (recupero): nessun invio per la 13",
    pass: stuckSent.length === 0 && stuck.weeks[0]?.state === "blocked",
    detail: JSON.stringify(stuck),
  });
  const writes = db.calls.filter((call) => !call.startsWith("select"));
  cases.push({
    name: "Scrive solo in engagement_notices",
    pass: writes.every((call) => call === "insert engagement_notices"),
    detail: writes.join(", "),
  });
  return cases;
}

export async function runLineupReminderChecks() {
  const cases = [...planCases(), ...await timelineCases(), ...await databaseCases()];
  const failures = cases.filter((item) => !item.pass).map((item) => `${item.name}: ${item.detail}`);
  return { passed: cases.length - failures.length, total: cases.length, failures, cases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runLineupReminderChecks().then((result) => {
    for (const item of result.cases) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}${item.pass ? "" : ` — ${item.detail}`}`);
    console.log(`Promemoria formazioni: ${result.passed}/${result.total}`);
    if (result.failures.length > 0) process.exit(1);
  });
}
