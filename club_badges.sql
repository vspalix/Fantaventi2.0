-- Colori e logo opzionale per i badge di Serie A.
-- Eseguilo nell'editor SQL di Supabase. L'app legge e scrive con la service role.

create table if not exists public.club_badges (
  club_code text primary key,
  primary_color text not null,
  secondary_color text not null,
  logo_url text,
  updated_at timestamptz not null default now()
);

alter table public.club_badges enable row level security;
