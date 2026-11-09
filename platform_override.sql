-- Controllo del super admin e checkpoint di mercato.
-- Eseguilo nell'editor SQL di Supabase dopo platform_access.sql e league_roles.sql.
-- Il service role delle API ignora la RLS. Le policy qui sotto valgono per un client authenticated.

alter table public.lineups
  add column if not exists origin text not null default 'user';

alter table public.lineups drop constraint if exists lineups_origin_check;
alter table public.lineups
  add constraint lineups_origin_check check (origin in ('user', 'office'));

create table if not exists public.roster_checkpoint_uses (
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  after_matchday  integer not null check (after_matchday >= 1),
  changes_used    integer not null default 0 check (changes_used >= 0),
  primary key (fantasy_team_id, after_matchday)
);

alter table public.roster_checkpoint_uses enable row level security;
revoke all on table public.roster_checkpoint_uses from public;
grant select, insert, update, delete on table public.roster_checkpoint_uses to service_role;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and platform_role = 'super_admin'
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated, service_role;

alter table public.private_leagues enable row level security;
alter table public.private_league_members enable row level security;
alter table public.league_delegates enable row level security;
alter table public.lineups enable row level security;

drop policy if exists private_leagues_super_admin on public.private_leagues;
create policy private_leagues_super_admin on public.private_leagues
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists private_leagues_member_read on public.private_leagues;
create policy private_leagues_member_read on public.private_leagues
  for select to authenticated
  using (
    owner_user_id = auth.uid()
    or exists (
      select 1
      from public.private_league_members member
      join public.fantasy_teams team on team.id = member.fantasy_team_id
      where member.private_league_id = private_leagues.id
        and team.user_id = auth.uid()
    )
  );

drop policy if exists private_league_members_super_admin on public.private_league_members;
create policy private_league_members_super_admin on public.private_league_members
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists league_delegates_super_admin on public.league_delegates;
create policy league_delegates_super_admin on public.league_delegates
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists lineups_super_admin on public.lineups;
create policy lineups_super_admin on public.lineups
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists roster_checkpoint_uses_super_admin on public.roster_checkpoint_uses;
create policy roster_checkpoint_uses_super_admin on public.roster_checkpoint_uses
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists private_league_members_member_read on public.private_league_members;
create policy private_league_members_member_read on public.private_league_members
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.fantasy_teams team
      where team.id = private_league_members.fantasy_team_id
        and team.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.private_leagues league
      where league.id = private_league_members.private_league_id
        and league.owner_user_id = auth.uid()
    )
  );

drop policy if exists league_delegates_member_read on public.league_delegates;
create policy league_delegates_member_read on public.league_delegates
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.private_leagues league
      where league.id = league_delegates.league_id
        and league.owner_user_id = auth.uid()
    )
  );

drop policy if exists lineups_member_read on public.lineups;
create policy lineups_member_read on public.lineups
  for select to authenticated
  using (
    exists (
      select 1
      from public.fantasy_teams team
      where team.id = lineups.fantasy_team_id
        and team.user_id = auth.uid()
    )
  );

drop policy if exists roster_checkpoint_uses_member_read on public.roster_checkpoint_uses;
create policy roster_checkpoint_uses_member_read on public.roster_checkpoint_uses
  for select to authenticated
  using (
    exists (
      select 1
      from public.fantasy_teams team
      where team.id = roster_checkpoint_uses.fantasy_team_id
        and team.user_id = auth.uid()
    )
  );

alter table public.roster_stints enable row level security;

drop policy if exists roster_stints_super_admin on public.roster_stints;
create policy roster_stints_super_admin on public.roster_stints
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists roster_stints_member_read on public.roster_stints;
create policy roster_stints_member_read on public.roster_stints
  for select to authenticated
  using (
    exists (
      select 1
      from public.fantasy_teams team
      where team.id = roster_stints.fantasy_team_id
        and team.user_id = auth.uid()
    )
  );

-- Il regolamento vive in regulation.sql. Se la tabella non c'è ancora, il resto di questo script resta valido.
do $$
begin
  if to_regclass('public.league_regulations') is null then
    return;
  end if;
  execute 'drop policy if exists league_regulations_super_admin on public.league_regulations';
  execute $policy$
    create policy league_regulations_super_admin on public.league_regulations
      for all to authenticated
      using (public.is_super_admin())
      with check (public.is_super_admin())
  $policy$;
end $$;
