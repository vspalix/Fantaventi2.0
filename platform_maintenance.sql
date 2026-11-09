-- Interruttore globale di manutenzione. Una sola riga.
-- Eseguilo nell'editor SQL di Supabase dopo platform_access.sql.

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

create table if not exists public.platform_maintenance (
  id         integer primary key check (id = 1),
  enabled    boolean not null default false,
  message    text not null default 'Manutenzione in corso. Puoi consultare la lega: formazioni e mercati restano chiusi fino alla fine del calcolo.',
  updated_at timestamptz not null default now()
);

insert into public.platform_maintenance (id, enabled)
values (1, false)
on conflict (id) do nothing;

alter table public.platform_maintenance enable row level security;
revoke all on table public.platform_maintenance from public;
grant select, insert, update, delete on table public.platform_maintenance to service_role;

drop policy if exists platform_maintenance_read on public.platform_maintenance;
create policy platform_maintenance_read on public.platform_maintenance
  for select to authenticated
  using (true);

drop policy if exists platform_maintenance_super_admin on public.platform_maintenance;
create policy platform_maintenance_super_admin on public.platform_maintenance
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
