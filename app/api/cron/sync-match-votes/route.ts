import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { alertVoteSync } from "@/lib/server/telegram-alert";
import { readSystemSettings, writeSyncLog, type SyncLogEntry } from "@/lib/server/system-settings";
import { syncScheduledVotes, type MatchVoteSyncResult } from "@/lib/server/sync-match-votes";
import { meter } from "@/lib/server/telemetry";

function cronAuthorized(request: Request) {
  const internal = request.headers.get("x-fantaventi-job") ?? "";
  const expected = (globalThis as { __fantaventiVoteSyncToken?: string }).__fantaventiVoteSyncToken;
  if (internal && expected && internal === expected) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const alternate = request.headers.get("x-cron-secret") ?? "";
  return bearer === secret || alternate === secret;
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
    const entry = voteLog(result, triggerSource);
    await writeSyncLog(entry);
    await alertVoteSync(entry, force, now, "changed" in result ? { changed: result.changed, samples: result.samples } : undefined);
    return NextResponse.json(result);
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
