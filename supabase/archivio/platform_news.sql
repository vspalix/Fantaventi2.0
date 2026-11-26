-- Fantaventi — news in home.
-- Eseguire nell'editor SQL di Supabase dopo platform_access.sql.

create table if not exists public.platform_news (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  link_url    text,
  link_label  text,
  pinned      boolean not null default false,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.platform_news enable row level security;
revoke all on table public.platform_news from public;
grant select, insert, update, delete on table public.platform_news to service_role;

drop policy if exists platform_news_read on public.platform_news;
create policy platform_news_read on public.platform_news
  for select to authenticated
  using (published = true or public.is_super_admin());

drop policy if exists platform_news_super_admin on public.platform_news;
create policy platform_news_super_admin on public.platform_news
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
