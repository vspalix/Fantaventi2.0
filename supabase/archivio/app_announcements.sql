-- Annunci in sovrimpressione e avvisi nella campanella.
-- Eseguilo nell'editor SQL di Supabase. L'app legge e scrive con la service role.

create table if not exists public.app_announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('text', 'image', 'both')),
  title text,
  body text,
  image_url text,
  cta_label text,
  cta_href text,
  is_active boolean not null default false,
  once_per_user boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists user_notices_user_idx on public.user_notices (user_id, created_at desc);

alter table public.app_announcements enable row level security;
alter table public.user_notices enable row level security;

revoke all on table public.app_announcements from public;
revoke all on table public.user_notices from public;
grant select, insert, update, delete on table public.app_announcements to service_role;
grant select, insert, update, delete on table public.user_notices to service_role;

drop policy if exists app_announcements_read on public.app_announcements;
create policy app_announcements_read on public.app_announcements
  for select to authenticated
  using (is_active = true or public.is_super_admin());

drop policy if exists app_announcements_admin on public.app_announcements;
create policy app_announcements_admin on public.app_announcements
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists user_notices_read on public.user_notices;
create policy user_notices_read on public.user_notices
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_notices_read_own on public.user_notices;
create policy user_notices_read_own on public.user_notices
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
