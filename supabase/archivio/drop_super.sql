-- Rimuove la regola SUPER da un database già creato.
-- Esegui prima roster_validation.sql, così il controllo rosa non legge più is_super.
-- Non cancella calciatori, rose, voti o punteggi.

alter table public.player_registrations
  drop column if exists is_super;

update public.rulesets
set definition = definition - 'max_super'
where definition ? 'max_super';
