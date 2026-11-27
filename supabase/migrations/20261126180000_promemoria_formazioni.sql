-- Promemoria automatico delle formazioni (preparato il 26/11/2026, NON ancora eseguito sul sito).
-- Da eseguire a mano nell'editor SQL di Supabase, dopo un backup e con la conferma dell'utente,
-- PRIMA di pubblicare il codice del ramo feat/promemoria-formazioni.
--
-- Cosa fa:
-- 1. aggiunge a system_settings l'interruttore del promemoria (acceso) e l'anticipo in minuti (180 = 3 ore);
-- 2. permette nello storico delle sincronizzazioni (sync_logs) la nuova voce "reminders".
-- Non tocca altre tabelle e non cancella niente. Si può rieseguire senza danni.
-- I promemoria già inviati si ricordano in engagement_notices, che esiste già.

begin;

alter table public.system_settings
  add column if not exists lineup_reminder_enabled boolean not null default true,
  add column if not exists lineup_reminder_lead_minutes integer not null default 180;

alter table public.system_settings
  drop constraint if exists system_settings_lineup_reminder_lead_check;
alter table public.system_settings
  add constraint system_settings_lineup_reminder_lead_check
  check (lineup_reminder_lead_minutes between 30 and 2880);

alter table public.sync_logs
  drop constraint if exists sync_logs_job_type_check;
alter table public.sync_logs
  add constraint sync_logs_job_type_check
  check (job_type = any (array['votes'::text, 'availability'::text, 'kickoffs'::text, 'reminders'::text]));

commit;

-- Verifica (deve restituire una riga con true e 180):
-- select lineup_reminder_enabled, lineup_reminder_lead_minutes from public.system_settings where id = 1;
