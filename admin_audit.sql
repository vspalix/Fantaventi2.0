-- Registro delle azioni sensibili fatte da un admin.
-- Eseguilo nell'editor SQL di Supabase. L'app scrive da sola, con il service role.

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;

revoke all on table public.admin_audit_logs from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_super_admin'
  ) then
    execute 'drop policy if exists admin_audit_logs_read on public.admin_audit_logs';
    execute 'create policy admin_audit_logs_read on public.admin_audit_logs for select to authenticated using (public.is_super_admin())';
  end if;
end $$;
