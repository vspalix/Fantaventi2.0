-- Fantaventi — partita rinviata.
-- Eseguire nell'editor SQL di Supabase.
-- postponed = true: i calciatori di quella partita restano senza voto
-- nella data originaria. Il laboratorio segna e toglie il rinvio.

alter table public.real_matches
  add column if not exists postponed boolean not null default false;
