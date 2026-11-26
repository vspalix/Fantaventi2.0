-- Banner in home e link delle probabili formazioni.
-- Eseguilo nell'editor SQL di Supabase. L'app legge e scrive con la service role.

create table if not exists public.platform_home (
  id int primary key default 1 check (id = 1),
  promo_image text,
  promo_href text,
  promo_label text,
  probabili_href text,
  updated_at timestamptz not null default now()
);

insert into public.platform_home (id)
values (1)
on conflict (id) do nothing;

alter table public.platform_home enable row level security;
