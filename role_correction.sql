-- Correzione manuale del ruolo. Eseguire nell'editor SQL di Supabase.
-- Un ruolo corretto da Listone caricato resta fermo anche al prossimo import.

alter table public.player_registrations
  add column if not exists role_locked boolean not null default false;
