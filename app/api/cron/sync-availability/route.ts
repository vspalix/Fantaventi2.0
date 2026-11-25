import { NextResponse } from "next/server";
import { syncAvailability } from "@/lib/server/availability";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, errorStatus } from "@/lib/server/session";
import { readSystemSettings, writeSyncLog, type SyncLogEntry } from "@/lib/server/system-settings";
import { alertAvailabilitySync } from "@/lib/server/telegram-alert";

export const maxDuration = 60;

function cronAuthorized(request: Request) {
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

async function run(request: Request) {
  const force = await requestedForce(request);
  const triggerSource = force ? "manual" : "cron";
  try {
    if (!(await authorized(request))) return NextResponse.json({ error: "Cron non autorizzato." }, { status: 401 });
    assertServiceEnv();
    const settings = await readSystemSettings();
    if (!force && !settings.autoSyncEnabled) {
      const message = "Sincronizzazione automatica disattivata.";
      await writeSyncLog({ jobType: "availability", triggerSource, status: "skipped", recordsWritten: 0, message });
      return NextResponse.json({ skipped: true, reason: message });
    }
    const result = await syncAvailability(force);
    const entry: SyncLogEntry = {
      jobType: "availability",
      triggerSource,
      status: result.skipped ? "skipped" : "success",
      recordsWritten: result.written,
      message: result.reason ?? "",
    };
    await writeSyncLog(entry);
    return NextResponse.json(result);
  } catch (error) {
    const entry: SyncLogEntry = {
      jobType: "availability",
      triggerSource,
      status: "error",
      recordsWritten: 0,
      message: errorMessage(error),
    };
    await writeSyncLog(entry);
    await alertAvailabilitySync(entry);
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
