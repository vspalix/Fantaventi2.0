-- Una squadra per lega, non una sola per stagione.
-- Eseguire nell'editor SQL di Supabase. Le rose già salvate restano dov'erano.
-- Il vincolo di tabella può essere già stato tolto: resta l'indice unico sulle squadre reali.

alter table public.fantasy_teams
  drop constraint if exists fantasy_teams_user_id_season_id_key;

drop index if exists public.fantasy_teams_user_id_season_id_key;
drop index if exists public.fantasy_teams_real_owner_uidx;

create index if not exists fantasy_teams_user_season_idx
  on public.fantasy_teams (user_id, season_id);
