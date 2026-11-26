-- Registro latenze del laboratorio. Eseguilo nell'editor SQL di Supabase.
-- Il service role e il pooler scrivono qui. Nessuna policy per gli utenti della lega.

create table if not exists public.ops_latency (
  id bigint generated always as identity primary key,
  operation text not null,
  duration_ms numeric not null,
  ok boolean not null,
  timed_out boolean not null default false,
  detail text,
  recorded_at timestamptz not null default now()
);

create index if not exists ops_latency_recorded_at_idx
  on public.ops_latency (recorded_at desc);

alter table public.ops_latency enable row level security;
