-- Fantaventi — RLS su tutto lo schema public.
-- Eseguilo nell'editor SQL di Supabase. È idempotente.
--
-- Chi legge cosa nell'app:
--   Il browser (chiave anon / publishable) parla solo con auth: login, logout, reset password.
--   Non fa select/insert sulle tabelle.
--   Le pagine, le API e i cron usano SUPABASE_SERVICE_ROLE_KEY.
--   Quel ruolo ha bypassrls: continua a leggere e scrivere anche dopo questo script.
--
-- Policy:
--   Catalogo (competizioni, club, giocatori, stagioni, giornate, partite): lettura anon e authenticated.
--   Profilo, squadra, formazione, lega: solo il proprietario, i compagni di lega o il super admin.
--   Scritture di mercato, voti, punteggi e sync: nessun permesso client. Le fa il service role.
--   Tabelle interne (voti, import, sync, snapshot): RLS attiva e nessun grant a anon/authenticated.

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

create or replace function public.can_read_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.fantasy_teams team
      where team.id = p_team
        and team.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.private_league_members mine
      join public.fantasy_teams my_team on my_team.id = mine.fantasy_team_id
      join public.private_league_members theirs on theirs.private_league_id = mine.private_league_id
      where my_team.user_id = auth.uid()
        and theirs.fantasy_team_id = p_team
    )
    or exists (
      select 1
      from public.private_leagues league
      join public.private_league_members member on member.private_league_id = league.id
      where league.owner_user_id = auth.uid()
        and member.fantasy_team_id = p_team
    );
$$;

revoke all on function public.can_read_team(uuid) from public;
grant execute on function public.can_read_team(uuid) to authenticated;

create or replace function public.can_read_league(p_league uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_super_admin() then
    return true;
  end if;

  if exists (
    select 1
    from public.private_leagues league
    where league.id = p_league
      and league.owner_user_id = auth.uid()
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.private_league_members member
    join public.fantasy_teams team on team.id = member.fantasy_team_id
    where member.private_league_id = p_league
      and team.user_id = auth.uid()
  ) then
    return true;
  end if;

  if to_regclass('public.league_delegates') is not null
     and exists (
       select 1
       from public.league_delegates delegate
       where delegate.league_id = p_league
         and delegate.user_id = auth.uid()
     ) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.can_read_league(uuid) from public;
grant execute on function public.can_read_league(uuid) to authenticated;

-- RLS su ogni tabella public, anche quelle nate fuori da schema.sql.
do $$
declare
  row record;
begin
  for row in
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', row.name);
  end loop;
end $$;

-- Catalogo: lettura pubblica. Nessuna scrittura dal client.
do $$
declare
  name text;
  catalog text[] := array[
    'competitions',
    'competition_translations',
    'seasons',
    'rulesets',
    'clubs',
    'club_translations',
    'season_clubs',
    'players',
    'player_registrations',
    'gameweeks',
    'real_matches',
    'bonus_type_translations'
  ];
begin
  foreach name in array catalog loop
    if to_regclass('public.' || name) is null then
      continue;
    end if;
    execute format('grant select on table public.%I to anon, authenticated', name);
    execute format('drop policy if exists %I on public.%I', name || '_public_read', name);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      name || '_public_read',
      name
    );
  end loop;
end $$;

-- Profilo: solo la propria riga. Il ruolo e la mail degli altri restano al service role.
do $$
begin
  if to_regclass('public.profiles') is null then
    return;
  end if;
  execute 'grant select on table public.profiles to authenticated';
  execute 'revoke insert, update, delete on table public.profiles from anon, authenticated';
  execute 'drop policy if exists profiles_self_read on public.profiles';
  execute $policy$
    create policy profiles_self_read on public.profiles
      for select to authenticated
      using (id = auth.uid() or public.is_super_admin())
  $policy$;
end $$;

-- Squadra: lettura per proprietario, compagni e admin di lega. Update solo del proprietario.
do $$
begin
  if to_regclass('public.fantasy_teams') is null then
    return;
  end if;
  execute 'grant select, update on table public.fantasy_teams to authenticated';
  execute 'revoke insert, delete on table public.fantasy_teams from anon, authenticated';
  execute 'revoke all on table public.fantasy_teams from anon';
  execute 'drop policy if exists fantasy_teams_read on public.fantasy_teams';
  execute $policy$
    create policy fantasy_teams_read on public.fantasy_teams
      for select to authenticated
      using (public.can_read_team(id))
  $policy$;
  execute 'drop policy if exists fantasy_teams_owner_update on public.fantasy_teams';
  execute $policy$
    create policy fantasy_teams_owner_update on public.fantasy_teams
      for update to authenticated
      using (user_id = auth.uid() or public.is_super_admin())
      with check (user_id = auth.uid() or public.is_super_admin())
  $policy$;
end $$;

-- Formazioni, rosa, risultati: lettura di lega. La scrittura passa da submit_lineup e dal service role.
do $$
declare
  spec record;
begin
  for spec in
    select *
    from (values
      ('lineups', 'fantasy_team_id'),
      ('roster_stints', 'fantasy_team_id'),
      ('roster_checkpoint_uses', 'fantasy_team_id'),
      ('team_gameweek_scores', 'fantasy_team_id')
    ) as item(table_name, team_column)
  loop
    if to_regclass('public.' || spec.table_name) is null then
      continue;
    end if;
    execute format('grant select on table public.%I to authenticated', spec.table_name);
    execute format('revoke insert, update, delete on table public.%I from anon, authenticated', spec.table_name);
    execute format('revoke all on table public.%I from anon', spec.table_name);
    execute format('drop policy if exists %I on public.%I', spec.table_name || '_league_read', spec.table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_team(%I))',
      spec.table_name || '_league_read',
      spec.table_name,
      spec.team_column
    );
  end loop;
end $$;

do $$
begin
  if to_regclass('public.lineup_slots') is not null then
    execute 'grant select on table public.lineup_slots to authenticated';
    execute 'revoke insert, update, delete on table public.lineup_slots from anon, authenticated';
    execute 'revoke all on table public.lineup_slots from anon';
    execute 'drop policy if exists lineup_slots_league_read on public.lineup_slots';
    execute $policy$
      create policy lineup_slots_league_read on public.lineup_slots
        for select to authenticated
        using (
          exists (
            select 1
            from public.lineups lineup
            where lineup.id = lineup_slots.lineup_id
              and public.can_read_team(lineup.fantasy_team_id)
          )
        )
    $policy$;
  end if;

  if to_regclass('public.lineup_player_scores') is not null then
    execute 'grant select on table public.lineup_player_scores to authenticated';
    execute 'revoke insert, update, delete on table public.lineup_player_scores from anon, authenticated';
    execute 'revoke all on table public.lineup_player_scores from anon';
    execute 'drop policy if exists lineup_player_scores_league_read on public.lineup_player_scores';
    execute $policy$
      create policy lineup_player_scores_league_read on public.lineup_player_scores
        for select to authenticated
        using (public.can_read_team(fantasy_team_id))
    $policy$;
  end if;
end $$;

-- Leghe: lettura per membri, proprietario, delegati e super admin.
do $$
begin
  if to_regclass('public.private_leagues') is not null then
    execute 'grant select on table public.private_leagues to authenticated';
    execute 'revoke insert, update, delete on table public.private_leagues from anon, authenticated';
    execute 'revoke all on table public.private_leagues from anon';
    execute 'drop policy if exists private_leagues_league_read on public.private_leagues';
    execute $policy$
      create policy private_leagues_league_read on public.private_leagues
        for select to authenticated
        using (public.can_read_league(id))
    $policy$;
  end if;

  if to_regclass('public.private_league_members') is not null then
    execute 'grant select on table public.private_league_members to authenticated';
    execute 'revoke insert, update, delete on table public.private_league_members from anon, authenticated';
    execute 'revoke all on table public.private_league_members from anon';
    execute 'drop policy if exists private_league_members_league_read on public.private_league_members';
    execute $policy$
      create policy private_league_members_league_read on public.private_league_members
        for select to authenticated
        using (public.can_read_league(private_league_id))
    $policy$;
  end if;

  if to_regclass('public.league_delegates') is not null then
    execute 'grant select on table public.league_delegates to authenticated';
    execute 'revoke insert, update, delete on table public.league_delegates from anon, authenticated';
    execute 'revoke all on table public.league_delegates from anon';
    execute 'drop policy if exists league_delegates_league_read on public.league_delegates';
    execute $policy$
      create policy league_delegates_league_read on public.league_delegates
        for select to authenticated
        using (user_id = auth.uid() or public.can_read_league(league_id))
    $policy$;
  end if;

  if to_regclass('public.league_regulations') is not null then
    execute 'grant select on table public.league_regulations to authenticated';
    execute 'revoke insert, update, delete on table public.league_regulations from anon, authenticated';
    execute 'revoke all on table public.league_regulations from anon';
    execute 'drop policy if exists league_regulations_league_read on public.league_regulations';
    execute $policy$
      create policy league_regulations_league_read on public.league_regulations
        for select to authenticated
        using (public.can_read_league(league_id))
    $policy$;
  end if;

  if to_regclass('public.league_feed') is not null then
    execute 'grant select on table public.league_feed to authenticated';
    execute 'revoke insert, update, delete on table public.league_feed from anon, authenticated';
    execute 'drop policy if exists league_feed_league_read on public.league_feed';
    execute $policy$
      create policy league_feed_league_read on public.league_feed
        for select to authenticated
        using (public.can_read_league(league_id))
    $policy$;
  end if;

  if to_regclass('public.league_badges') is not null then
    execute 'grant select on table public.league_badges to authenticated';
    execute 'revoke insert, update, delete on table public.league_badges from anon, authenticated';
    execute 'drop policy if exists league_badges_league_read on public.league_badges';
    execute $policy$
      create policy league_badges_league_read on public.league_badges
        for select to authenticated
        using (public.can_read_league(league_id) or public.can_read_team(fantasy_team_id))
    $policy$;
  end if;
end $$;

-- Tabelle interne: il client non le vede. Il service role le scrive lo stesso.
do $$
declare
  name text;
  locked text[] := array[
    'vote_imports',
    'player_gameweek_stats',
    'checkpoints',
    'checkpoint_moves',
    'calendar_sync_runs',
    'external_fixtures',
    'gameweek_overrides',
    'engagement_notices',
    'live_rank_snapshots',
    'ops_latency',
    'notification_templates'
  ];
begin
  foreach name in array locked loop
    if to_regclass('public.' || name) is null then
      continue;
    end if;
    execute format('revoke all on table public.%I from anon, authenticated', name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', name);
    -- La vista gameweeks_with_overrides fa left join su questa tabella.
    -- Senza il grant la vista fallisce; senza policy la RLS non restituisce righe.
    if name = 'gameweek_overrides' then
      execute 'grant select on table public.gameweek_overrides to anon, authenticated';
    end if;
  end loop;
end $$;

-- La vista deve rispettare le policy di chi la interroga, non quelle del proprietario.
do $$
begin
  if to_regclass('public.gameweeks_with_overrides') is not null then
    execute 'alter view public.gameweeks_with_overrides set (security_invoker = true)';
    execute 'grant select on table public.gameweeks_with_overrides to anon, authenticated, service_role';
  end if;
end $$;
