-- Regole della lega e stato locked delle partite.
-- Eseguire nell'editor SQL di Supabase.

alter table public.private_leagues
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.player_gameweek_stats
  add column if not exists postponed boolean not null default false;

do $$
begin
  alter type public.match_status add value if not exists 'locked';
exception
  when duplicate_object then null;
end $$;
