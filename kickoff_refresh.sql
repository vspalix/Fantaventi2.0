-- Fantaventi — orario fissato a mano
-- Eseguire nell'editor SQL di Supabase dopo production_architecture.sql.
--
-- Una partita con kickoff_locked non viene spostata dall'aggiornamento
-- settimanale degli orari Sky. La deadline impostata a mano resta in
-- gameweek_overrides, già creata da calendar_setup.sql.

alter table public.real_matches
  add column if not exists kickoff_locked boolean not null default false;
