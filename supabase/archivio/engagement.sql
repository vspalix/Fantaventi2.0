-- Bacheca, badge, push e snapshot della classifica live.
-- Eseguilo nell'editor SQL di Supabase dopo platform_access.sql.
-- Il service role delle API ignora la RLS.

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

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  p256dh      text not null,
  auth_secret text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.notification_templates (
  kind     text primary key check (kind in ('deadline', 'bonus', 'overtake')),
  title    text not null,
  body     text not null,
  enabled  boolean not null default true
);

insert into public.notification_templates (kind, title, body, enabled) values
  ('deadline', 'Chiudi la formazione', 'Mancano 30 minuti alla giornata {matchday}. Se non la invii, resta l''ultima schierata. Alla prima giornata la compone il sistema.', true),
  ('bonus', 'Bonus in campo', '{player}: {event}.', true),
  ('overtake', 'Sorpasso live', '{opponent} ti ha superato. Giornata {matchday}.', true)
on conflict (kind) do nothing;

create table if not exists public.engagement_notices (
  dedupe_key text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.league_feed (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.private_leagues (id) on delete cascade,
  gameweek_id uuid references public.gameweeks (id) on delete set null,
  kind        text not null check (kind in ('mercato', 'risultati', 'badge', 'ribaltone')),
  body        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.league_badges (
  id               uuid primary key default gen_random_uuid(),
  league_id        uuid not null references public.private_leagues (id) on delete cascade,
  gameweek_id      uuid not null references public.gameweeks (id) on delete cascade,
  fantasy_team_id  uuid not null references public.fantasy_teams (id) on delete cascade,
  kind             text not null check (kind in ('pollo', 're_bonus', 'rigorista')),
  title            text not null,
  detail           text not null,
  created_at       timestamptz not null default now(),
  unique (league_id, gameweek_id, kind)
);

create table if not exists public.live_rank_snapshots (
  league_id        uuid not null references public.private_leagues (id) on delete cascade,
  gameweek_id      uuid not null references public.gameweeks (id) on delete cascade,
  fantasy_team_id  uuid not null references public.fantasy_teams (id) on delete cascade,
  points           numeric(8,2) not null,
  primary key (league_id, gameweek_id, fantasy_team_id)
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_templates enable row level security;
alter table public.league_feed enable row level security;
alter table public.league_badges enable row level security;

revoke all on table public.push_subscriptions from public;
revoke all on table public.notification_templates from public;
revoke all on table public.engagement_notices from public;
revoke all on table public.league_feed from public;
revoke all on table public.league_badges from public;
revoke all on table public.live_rank_snapshots from public;

grant select, insert, update, delete on table public.push_subscriptions to service_role;
grant select, insert, update, delete on table public.notification_templates to service_role;
grant select, insert, update, delete on table public.engagement_notices to service_role;
grant select, insert, update, delete on table public.league_feed to service_role;
grant select, insert, update, delete on table public.league_badges to service_role;
grant select, insert, update, delete on table public.live_rank_snapshots to service_role;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists notification_templates_super_admin on public.notification_templates;
create policy notification_templates_super_admin on public.notification_templates
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists league_feed_read on public.league_feed;
create policy league_feed_read on public.league_feed
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.private_league_members member
      join public.fantasy_teams team on team.id = member.fantasy_team_id
      where member.private_league_id = league_feed.league_id
        and team.user_id = auth.uid()
    )
  );

drop policy if exists league_badges_read on public.league_badges;
create policy league_badges_read on public.league_badges
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.private_league_members member
      join public.fantasy_teams team on team.id = member.fantasy_team_id
      where member.private_league_id = league_badges.league_id
        and team.user_id = auth.uid()
    )
  );
