-- Admin delegati di una singola lega.
-- Eseguilo nell'editor SQL di Supabase, dopo platform_access.sql.
-- Il creatore resta owner_user_id. Un delegato gestisce inviti, partecipanti e regole
-- di quella lega e non diventa super admin della piattaforma.

create table if not exists public.league_delegates (
  league_id   uuid not null references public.private_leagues (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  granted_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.league_delegates enable row level security;

revoke all on table public.league_delegates from public;
grant select, insert, update, delete on table public.league_delegates to service_role;
