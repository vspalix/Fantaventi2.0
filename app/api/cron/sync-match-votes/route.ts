import { after, NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { cronSecretAccepted } from "@/lib/server/access-policy";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage } from "@/lib/server/session";
import { runLineupReminderSafely } from "@/lib/server/lineup-reminder";
import { alertVoteSync } from "@/lib/server/telegram-alert";
import { writeSyncLog, type SyncLogEntry } from "@/lib/server/system-settings";
import { prepareVoteClock, runPlannedReads, syncDueMatchVotes } from "@/lib/server/sync-match-votes";
import type { CycleReport } from "@/lib/server/vote-engine";
import { planIsEmpty } from "@/lib/server/vote-schedule";
import { meter } from "@/lib/server/telemetry";

// Le letture continuano dopo la risposta: la sveglia esterna aspetta al massimo 30 secondi.
export const maxDuration = 60;

function cronAuthorized(request: Request) {
  const internal = request.headers.get("x-fantaventi-job") ?? "";
  const expected = (globalThis as { __fantaventiVoteSyncToken?: string }).__fantaventiVoteSyncToken;
  if (internal && expected && internal === expected) return true;
  return cronSecretAccepted(request.headers, process.env.CRON_SECRET);
}

async function authorized(request: Request) {
  if (cronAuthorized(request)) return true;
  try {
    await requireSuperAdmin();
    return true;
  } catch {
    return false;
  }
}

async function requestedForce(request: Request) {
  if (request.method !== "POST") return false;
  const text = await request.text();
  if (!text.trim()) return false;
  try {
    const body = JSON.parse(text) as { force?: unknown };
    return body?.force === true;
  } catch {
    return false;
  }
}

function voteLog(report: CycleReport, triggerSource: SyncLogEntry["triggerSource"]): SyncLogEntry {
  const recordsWritten = report.synced.reduce((sum, item) => sum + item.players, 0);
  const lines = [
    report.reads.length > 0 ? `Letture: ${report.reads.join(", ")}.` : "Nessuna lettura.",
    recordsWritten > 0 ? `Voti ufficiali: ${recordsWritten}.` : "",
    report.scored.length > 0 ? `Calcolate le giornate ${[...new Set(report.scored)].join(", ")}.` : "",
    ...[...new Set(report.waiting.map((item) => item.reason))].slice(0, 3),
    ...report.errors.map((item) => item.message),
  ];
  const wrote = recordsWritten > 0 || report.scored.length > 0 || report.projected.length > 0 || report.calendarChanged > 0;
  const status = report.errors.length > 0 && !wrote ? "error" : wrote ? "success" : "skipped";
  return { jobType: "votes", triggerSource, status, recordsWritten, message: lines.filter(Boolean).join(" ") };
}

async function failed(error: unknown, triggerSource: SyncLogEntry["triggerSource"]) {
  const entry: SyncLogEntry = {
    jobType: "votes",
    triggerSource,
    status: "error",
    recordsWritten: 0,
    message: errorMessage(error),
  };
  await writeSyncLog(entry);
  await alertVoteSync(entry, triggerSource === "manual");
}

// Voti inseriti, giornata calcolata e letture fallite li avvisa il giro stesso (vote-engine).
async function finished(report: CycleReport, triggerSource: SyncLogEntry["triggerSource"]) {
  await writeSyncLog(voteLog(report, triggerSource));
}

async function run(request: Request) {
  const force = await requestedForce(request);
  try {
    if (!(await authorized(request))) {
      return NextResponse.json({ error: "Cron non autorizzato." }, { status: 401 });
    }
    assertServiceEnv();
    const now = new Date();

    if (force) {
      try {
        const report = await meter("vote-fetch", () => syncDueMatchVotes(now));
        await finished(report, "manual");
        return NextResponse.json(report);
      } catch (error) {
        await failed(error, "manual");
        throw error;
      }
    }

    // Fuori dai momenti previsti: una sola lettura, nessuna scrittura, nessun contatto con le fonti.
    const { snapshot, plan } = await prepareVoteClock(now);
    if (planIsEmpty(plan)) {
      // Il promemoria delle formazioni usa la stessa sveglia e parte dopo la risposta.
      after(() => runLineupReminderSafely(now.getTime()));
      return NextResponse.json({ skipped: true, reason: snapshot.auto ? "Niente da fare adesso." : "Sincronizzazione automatica disattivata." });
    }
    after(async () => {
      // Prima il promemoria: è breve e non deve aspettare le letture dei voti.
      await runLineupReminderSafely(now.getTime());
      try {
        const report = await meter("vote-fetch", () => runPlannedReads(snapshot, plan, now));
        // Se un'altra chiamata ha già preso le stesse letture, non c'è niente da registrare.
        if (report.reads.length > 0 || report.scored.length > 0 || report.errors.length > 0) {
          await finished(report, "cron");
        }
      } catch (error) {
        await failed(error, "cron");
      }
    });
    return NextResponse.json({
      accepted: true,
      reads: plan.reads.map((task) => ({ kind: task.kind, attempt: task.attempt })),
      alerts: plan.alerts.length,
      calculations: plan.calculations.length,
    });
  } catch (error) {
    return apiError("API /api/cron/sync-match-votes", error);
  }
}

export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
