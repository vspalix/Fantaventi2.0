import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { processMatchday } from "@/lib/server/process-matchday";
import { errorMessage, errorStatus } from "@/lib/server/session";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const alternate = request.headers.get("x-cron-secret") ?? "";
  return bearer === secret || alternate === secret;
}

async function run(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: "Cron non autorizzato." }, { status: 401 });
    }
    assertServiceEnv();
    const result = await processMatchday();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
