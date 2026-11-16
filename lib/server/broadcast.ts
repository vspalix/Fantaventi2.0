import { createAdminSupabase } from "@/lib/supabase/admin";

export type BroadcastInput = {
  subject: string;
  message: string;
  leagueId: string | null;
  inbox: boolean;
  email: boolean;
  testUserId: string | null;
  testEmail: string | null;
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function parseBroadcast(input: unknown, self: { id: string; email: string | null }): BroadcastInput & { confirm: boolean; test: boolean } {
  const body = input as {
    subject?: unknown;
    message?: unknown;
    leagueId?: unknown;
    inbox?: unknown;
    email?: unknown;
    confirm?: unknown;
    test?: unknown;
  };
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 120) : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!subject || !message) throw httpError("Oggetto e messaggio sono obbligatori.", 400);
  const inbox = body.inbox !== false;
  const email = body.email === true;
  if (!inbox && !email) throw httpError("Scegli almeno un canale.", 400);
  const test = body.test === true;
  if (!test && body.confirm !== true) throw httpError("Conferma l'invio prima di scriverlo a tutti.", 400);
  const leagueId = typeof body.leagueId === "string" && body.leagueId ? body.leagueId : null;
  return {
    subject,
    message,
    leagueId: test ? null : leagueId,
    inbox,
    email,
    testUserId: test ? self.id : null,
    testEmail: test ? self.email : null,
    confirm: body.confirm === true,
    test,
  };
}

async function recipientIds(leagueId: string | null) {
  const admin = createAdminSupabase();
  if (!leagueId) {
    const profiles = await admin.from("profiles").select("id, email");
    if (profiles.error) throw new Error(profiles.error.message);
    return (profiles.data ?? []).map((row) => ({
      id: row.id as string,
      email: typeof row.email === "string" ? row.email : "",
    }));
  }
  const members = await admin.from("private_league_members").select("fantasy_team_id").eq("private_league_id", leagueId);
  if (members.error) throw new Error(members.error.message);
  const teamIds = (members.data ?? []).map((row) => row.fantasy_team_id as string);
  if (teamIds.length === 0) return [];
  const teams = await admin.from("fantasy_teams").select("user_id").in("id", teamIds);
  if (teams.error) throw new Error(teams.error.message);
  const userIds = [...new Set((teams.data ?? []).map((row) => row.user_id as string))];
  const profiles = await admin.from("profiles").select("id, email").in("id", userIds);
  if (profiles.error) throw new Error(profiles.error.message);
  return (profiles.data ?? []).map((row) => ({
    id: row.id as string,
    email: typeof row.email === "string" ? row.email : "",
  }));
}

async function sendEmail(to: string, subject: string, message: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return "missing" as const;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text: message }),
  });
  if (!response.ok) return "failed" as const;
  return "sent" as const;
}

export async function sendBroadcast(input: BroadcastInput) {
  const people = input.testUserId
    ? [{ id: input.testUserId, email: input.testEmail ?? "" }]
    : await recipientIds(input.leagueId);
  const admin = createAdminSupabase();
  let inbox = 0;
  let mailed = 0;
  let emailSkipped = false;
  if (input.inbox && people.length > 0) {
    const rows = people.map((person) => ({ user_id: person.id, title: input.subject, body: input.message }));
    const saved = await admin.from("user_notices").insert(rows);
    if (saved.error) {
      if (/user_notices|schema cache|does not exist/i.test(saved.error.message)) {
        throw httpError("Manca la tabella. Esegui app_announcements.sql nell'editor SQL.", 503);
      }
      throw new Error(saved.error.message);
    }
    inbox = people.length;
  }
  if (input.email) {
    for (const person of people) {
      if (!person.email.includes("@")) continue;
      const result = await sendEmail(person.email, input.subject, input.message);
      if (result === "missing") {
        emailSkipped = true;
        break;
      }
      if (result === "sent") mailed += 1;
    }
  }
  return { recipients: people.length, inbox, mailed, emailSkipped };
}

export async function listBroadcastLeagues() {
  const admin = createAdminSupabase();
  const rows = await admin.from("private_leagues").select("id, name, is_sandbox").order("name").limit(80);
  if (rows.error) {
    const plain = await admin.from("private_leagues").select("id, name").order("name").limit(80);
    if (plain.error) return [];
    return (plain.data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
  }
  return (rows.data ?? [])
    .filter((row) => row.is_sandbox !== true)
    .map((row) => ({ id: row.id as string, name: row.name as string }));
}
