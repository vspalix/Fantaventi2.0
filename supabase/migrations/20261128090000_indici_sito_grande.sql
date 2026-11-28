-- Indici per un sito con tante squadre: senza, il database scorre tabelle intere a ogni richiesta.
-- Aggiunge solo indici: nessun dato e nessuna colonna cambia. Si può eseguire più volte.
-- Da eseguire a mano nell'editor SQL di Supabase, dopo un backup (regole in supabase/README.md).
-- L'app funziona anche senza: con pochi utenti la differenza non si nota.

begin;

create index if not exists lineups_gameweek_idx on public.lineups (gameweek_id);
create index if not exists roster_stints_team_idx on public.roster_stints (fantasy_team_id);
create index if not exists private_league_members_team_idx on public.private_league_members (fantasy_team_id);
create index if not exists private_leagues_season_name_idx on public.private_leagues (season_id, name);
create index if not exists private_leagues_owner_idx on public.private_leagues (owner_user_id);
create index if not exists fantasy_teams_season_idx on public.fantasy_teams (season_id);
create index if not exists team_gameweek_scores_gameweek_idx on public.team_gameweek_scores (gameweek_id);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

commit;

-- Verifica: devono risultare 8 righe.
select indexname from pg_indexes
where schemaname = 'public' and indexname in (
  'lineups_gameweek_idx', 'roster_stints_team_idx', 'private_league_members_team_idx', 'private_leagues_season_name_idx',
  'private_leagues_owner_idx', 'fantasy_teams_season_idx', 'team_gameweek_scores_gameweek_idx', 'push_subscriptions_user_idx'
)
order by indexname;
