-- Token push nativi (APNs su iOS, FCM su Android).
-- Incollalo nell'editor SQL di Supabase. È idempotente.
-- Richiede public.is_super_admin() (già creato da engagement.sql).
-- Le API salvano il token con la service role, che ignora la RLS.

create table if not exists public.device_push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.device_push_tokens enable row level security;

revoke all on table public.device_push_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.device_push_tokens to authenticated, service_role;

drop policy if exists device_push_tokens_own on public.device_push_tokens;
create policy device_push_tokens_own on public.device_push_tokens
  for all to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());
