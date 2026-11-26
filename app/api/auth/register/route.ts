import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-error";
import { registerAccount, type RegistrationInput } from "@/lib/server/register-account";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    if (!hasServiceSupabaseEnv()) {
      return NextResponse.json({ error: "Configura Supabase prima di registrare un account." }, { status: 409 });
    }
    const body = (await request.json()) as RegistrationInput;
    const account = await registerAccount(body);
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    return apiError("API /api/auth/register (POST)", error);
  }
}
