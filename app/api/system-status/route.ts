import { NextResponse } from "next/server";
import { probePooler } from "@/lib/server/pooler";
import { createAdminSupabase } from "@/lib/supabase/admin";

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Controllo di stato non riuscito.";
  if (message.includes("://") || message.includes("@")) return "Controllo di stato non riuscito.";
  return message.slice(0, 180);
}

export async function GET() {
  let pooler: Awaited<ReturnType<typeof probePooler>> | null = null;
  let started = performance.now();
  try {
    pooler = await probePooler();
    const admin = createAdminSupabase();
    started = performance.now();
    const { error } = await admin.from("private_leagues").select("id").limit(1);
    if (error) throw new Error(error.message);
    return NextResponse.json({
      success: true,
      pooler: {
        up: pooler.up,
        port: 6543,
        mode: "transaction" as const,
        latencyMs: pooler.latencyMs,
        detail: pooler.detail,
      },
      database: {
        up: true,
        latencyMs: Math.round(performance.now() - started),
        detail: "La tabella leghe risponde.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        pooler: pooler
          ? {
              up: pooler.up,
              port: 6543,
              mode: "transaction" as const,
              latencyMs: pooler.latencyMs,
              detail: pooler.detail,
            }
          : null,
        database: {
          up: false,
          latencyMs: Math.round(performance.now() - started),
          detail: safeMessage(error),
        },
        error: safeMessage(error),
      },
      { status: 500 },
    );
  }
}
