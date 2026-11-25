import { NextResponse } from "next/server";
import { cronSecretAccepted } from "@/lib/server/access-policy";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { alertVoteSync } from "@/lib/server/telegram-alert";
import { readSystemSettings, writeSyncLog, type SyncLogEntry } from "@/lib/server/system-settings";
import { closeFinishedGameweeks } from "@/lib/server/gameweek-lifecycle";
import { syncScheduledVotes, type MatchVoteSyncResult } from "@/lib/server/sync-match-votes";
import { meter } from "@/lib/server/telemetry";

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

function voteLog(result: MatchVoteSyncResult | { skipped: true; reason: string }, triggerSource: SyncLogEntry["triggerSource"]): SyncLogEntry {
  if ("reason" in result && result.skipped === true) {
    return { jobType: "votes", triggerSource, status: "skipped", recordsWritten: 0, message: result.reason };
  }
  const sync = result as MatchVoteSyncResult;
  const recordsWritten = sync.synced.reduce((sum, item) => sum + item.players, 0);
  if (sync.errors.length > 0 && recordsWritten === 0 && sync.scored.length === 0) {
    return {
      jobType: "votes",
      triggerSource,
      status: "error",
      recordsWritten: 0,
      message: sync.errors.map((item) => item.message).join(" ") || "Sincronizzazione voti non riuscita.",
    };
  }
  return { jobType: "votes", triggerSource, status: "success", recordsWritten, message: `Aggiornati ${recordsWritten} voti.` };
}

async function run(request: Request) {
  const force = await requestedForce(request);
  const triggerSource = force ? "manual" : "cron";
  try {
    if (!(await authorized(request))) {
      return NextResponse.json({ error: "Cron non autorizzato." }, { status: 401 });
    }
    assertServiceEnv();
    const settings = await readSystemSettings();
    if (!force && !settings.autoSyncEnabled) {
      const message = "Sincronizzazione automatica disattivata.";
      await writeSyncLog({ jobType: "votes", triggerSource, status: "skipped", recordsWritten: 0, message });
      return NextResponse.json({ skipped: true, reason: message });
    }
    const now = new Date();
    const result = await meter("vote-fetch", () => syncScheduledVotes(now, force));
    const settled = await closeFinishedGameweeks(now).catch((error: unknown) => ({
      closed: [] as number[],
      waiting: [{ number: 0, reason: errorMessage(error) }],
    }));
    let entry = voteLog(result, triggerSource);
    if (settled.closed.length > 0) {
      const note = `Calcolate le giornate ${settled.closed.join(", ")}.`;
      entry = entry.status === "error"
        ? entry
        : { ...entry, status: "success", recordsWritten: Math.max(entry.recordsWritten, settled.closed.length), message: entry.status === "skipped" ? note : `${entry.message} ${note}` };
    }
    await writeSyncLog(entry);
    const detail = settled.closed.length > 0
      ? { changed: settled.closed.length, samples: settled.closed.map((number) => `Giornata ${number} calcolata`) }
      : "changed" in result ? { changed: result.changed, samples: result.samples } : undefined;
    await alertVoteSync(entry, force, now, detail);
    return NextResponse.json({ ...result, settled });
  } catch (error) {
    const entry: SyncLogEntry = {
      jobType: "votes",
      triggerSource,
      status: "error",
      recordsWritten: 0,
      message: errorMessage(error),
    };
    await writeSyncLog(entry);
    await alertVoteSync(entry, force);
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
