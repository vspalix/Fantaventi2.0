-- Obbliga il cambio password al prossimo accesso.
-- Eseguilo nell'editor SQL di Supabase, dopo profile_identity.sql.
alter table public.profiles
  add column if not exists must_reset_password boolean not null default false;
