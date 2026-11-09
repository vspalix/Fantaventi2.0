import { createAdminSupabase } from "@/lib/supabase/admin";

export type RegistrationInput = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  emailConfirm?: string;
  password?: string;
  passwordConfirm?: string;
  acceptRules?: boolean;
};

function fail(message: string, status: number) {
  const error = new Error(message);
  (error as Error & { status: number }).status = status;
  return error;
}

function cleanName(value: string | undefined, label: string) {
  const name = value?.trim().replace(/\s+/g, " ") ?? "";
  if (name.length < 2 || name.length > 40 || !/^[\p{L}][\p{L}'’ -]*$/u.test(name)) {
    throw fail(`${label} deve avere tra 2 e 40 lettere.`, 400);
  }
  return name;
}

function cleanPhone(value: string | undefined) {
  const raw = value?.trim() ?? "";
  const digits = raw.replace(/[^\d+]/g, "");
  const numeric = digits.replace(/\D/g, "");
  if (numeric.length < 8 || numeric.length > 15 || !/^\+?\d+$/.test(digits)) {
    throw fail("Inserisci un numero di telefono valido.", 400);
  }
  return digits.startsWith("+") ? digits : numeric;
}

function cleanEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    throw fail("Inserisci un'email valida.", 400);
  }
  return email;
}

function alreadyRegistered(message: string) {
  return /already registered|already been registered|email_exists|user already exists|duplicate/i.test(message);
}

function missingProfileColumns(message: string) {
  return /column|schema cache|could not find/i.test(message) && /email|first_name|last_name|phone/i.test(message);
}

export async function registerAccount(input: RegistrationInput) {
  const firstName = cleanName(input.firstName, "Il nome");
  const lastName = cleanName(input.lastName, "Il cognome");
  const phone = cleanPhone(input.phone);
  const email = cleanEmail(input.email);
  const emailConfirm = cleanEmail(input.emailConfirm);
  if (email !== emailConfirm) throw fail("Le due email non coincidono.", 400);
  const password = input.password ?? "";
  if (password.length < 8 || password.length > 72) throw fail("La password deve avere almeno 8 caratteri.", 400);
  if (password !== input.passwordConfirm) throw fail("Le due password non coincidono.", 400);
  if (input.acceptRules !== true) throw fail("Per registrarti accetta il regolamento.", 400);

  const admin = createAdminSupabase();
  const existing = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing.error && !missingProfileColumns(existing.error.message)) throw new Error(existing.error.message);
  if (existing.data) throw fail("Questa email è già registrata. Accedi con la password.", 409);

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, phone },
  });
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? "Registrazione non riuscita.";
    if (alreadyRegistered(message)) throw fail("Questa email è già registrata. Accedi con la password.", 409);
    throw new Error(message);
  }

  const userId = created.data.user.id;
  const profile = await admin.from("profiles").upsert({
    id: userId,
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    display_name: `${firstName} ${lastName}`,
    locale: "it",
  }, { onConflict: "id" });
  if (profile.error) {
    await admin.auth.admin.deleteUser(userId);
    if (missingProfileColumns(profile.error.message)) {
      throw fail("Per salvare nome, telefono ed email esegui profile_identity.sql.", 409);
    }
    throw new Error(profile.error.message);
  }

  return { email };
}
