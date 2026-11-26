import { NextResponse } from "next/server";
import { reportError } from "@/lib/server/error-report";
import { describeForUser, isFrameworkSignal } from "@/lib/server/error-text";

/** Il messaggio da mostrare. Se il guasto è nostro, parte anche la segnalazione. */
export function publicError(where: string, error: unknown) {
  if (isFrameworkSignal(error)) throw error;
  const view = describeForUser(error);
  if (view.report) void reportError(where, error);
  return view;
}

export function apiError(where: string, error: unknown) {
  const { message, status } = publicError(where, error);
  return NextResponse.json({ error: message }, { status });
}
