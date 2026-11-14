-- Stato di una partita rinviata o sospesa (voti sub iudice).
-- Eseguilo nell'editor SQL di Supabase.
-- postponed resta allineato: true quando la partita non è in calendario.

alter table public.real_matches
  add column if not exists hold_status text not null default 'none';

alter table public.real_matches
  drop constraint if exists real_matches_hold_status;

alter table public.real_matches
  add constraint real_matches_hold_status
  check (hold_status in ('none', 'postponed', 'suspended'));

update public.real_matches
set hold_status = 'postponed'
where postponed = true
  and hold_status = 'none';
