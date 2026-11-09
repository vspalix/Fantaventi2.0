-- Ruolo di piattaforma e formato di competizione della lega.
-- Eseguilo nell'editor SQL di Supabase.

alter table public.profiles
  add column if not exists platform_role text not null default 'member';

alter table public.profiles
  drop constraint if exists profiles_platform_role;

alter table public.profiles
  add constraint profiles_platform_role
  check (platform_role in ('member', 'super_admin'));

update public.profiles
set platform_role = 'super_admin'
where id = '21d2143c-689b-4cdd-b84f-b6b93857c531';

alter table public.private_leagues
  add column if not exists competition_format text not null default 'classic';

alter table public.private_leagues
  drop constraint if exists private_leagues_competition_format;

alter table public.private_leagues
  add constraint private_leagues_competition_format
  check (competition_format in ('classic', 'h2h', 'hybrid'));

update public.private_leagues
set competition_format = case
  when settings ->> 'format' in ('classic', 'h2h', 'hybrid') then settings ->> 'format'
  when settings ->> 'ranking' = 'head_to_head' then 'h2h'
  else 'classic'
end;
