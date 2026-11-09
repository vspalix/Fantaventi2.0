import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const weeks = await admin.from("gameweeks").select("id, number, status, deadline_at").order("number");
if (weeks.error) throw new Error(weeks.error.message);

const overrides = await admin.from("gameweek_overrides").select("gameweek_id, deadline_at");
const manual = new Set();
if (!overrides.error) {
  for (const row of overrides.data ?? []) {
    if (row.deadline_at) manual.add(row.gameweek_id);
  }
} else if (!/gameweek_overrides|schema cache|could not find/i.test(overrides.error.message)) {
  throw new Error(overrides.error.message);
}

const ids = (weeks.data ?? []).map((week) => week.id);
const matches = await admin.from("real_matches").select("gameweek_id, kickoff_at").in("gameweek_id", ids);
if (matches.error) throw new Error(matches.error.message);

const firstKickoff = new Map();
for (const match of matches.data ?? []) {
  const time = new Date(match.kickoff_at).getTime();
  if (!Number.isFinite(time)) continue;
  const current = firstKickoff.get(match.gameweek_id);
  if (current === undefined || time < current) firstKickoff.set(match.gameweek_id, time);
}

const changed = [];
for (const week of weeks.data ?? []) {
  if (week.status === "final" || manual.has(week.id)) continue;
  const kickoff = firstKickoff.get(week.id);
  if (kickoff === undefined) continue;
  const deadline = new Date(kickoff - 60 * 1000).toISOString();
  if (deadline === new Date(week.deadline_at).toISOString()) continue;
  const update = await admin.from("gameweeks").update({ deadline_at: deadline }).eq("id", week.id).eq("status", week.status);
  if (update.error) throw new Error(`Giornata ${week.number}: ${update.error.message}`);
  changed.push({ number: week.number, status: week.status, from: week.deadline_at, to: deadline });
}

console.log(JSON.stringify(changed.filter((row) => row.number <= 12 || row.number === 11), null, 2));
console.log("updated", changed.length);
