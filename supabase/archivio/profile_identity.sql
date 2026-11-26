-- Anagrafica degli account. Esegui nell'editor SQL di Supabase.
alter table public.profiles
  add column if not exists email text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text;

create unique index if not exists profiles_email_uidx
  on public.profiles (lower(email))
  where email is not null;
