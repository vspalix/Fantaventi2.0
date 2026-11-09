-- Fantaventi — lock di riga sui salvataggi formazione.
-- Eseguire nell'editor SQL di Supabase.
-- submit_lineup in league_hub.sql blocca la squadra con FOR UPDATE.
-- Questo file aggiunge lo stesso lock anche agli upsert diretti
-- e impedisce due slot dello stesso calciatore nella stessa formazione.

create or replace function public.lock_fantasy_team_for_lineup()
returns trigger
language plpgsql
as $$
begin
  perform 1
  from public.fantasy_teams
  where id = new.fantasy_team_id
  for update;
  return new;
end;
$$;

drop trigger if exists lineup_team_lock on public.lineups;

create trigger lineup_team_lock
before insert or update on public.lineups
for each row
execute function public.lock_fantasy_team_for_lineup();

do $$
begin
  create unique index if not exists lineup_slots_lineup_player_uidx
    on public.lineup_slots (lineup_id, player_id);
exception
  when unique_violation then
    raise notice 'Indice non creato: esistono già slot duplicati nella stessa formazione.';
end
$$;
