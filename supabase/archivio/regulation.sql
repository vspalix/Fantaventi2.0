-- Regolamento ufficiale, un testo per lega.
-- Eseguilo nell'editor SQL di Supabase.

create table if not exists public.league_regulations (
  league_id   uuid primary key references public.private_leagues (id) on delete cascade,
  body_md     text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.league_regulations enable row level security;

drop policy if exists league_regulations_read on public.league_regulations;
create policy league_regulations_read on public.league_regulations
  for select to authenticated
  using (
    exists (
      select 1 from public.private_leagues as league
      where league.id = league_id and league.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.private_league_members as member
      join public.fantasy_teams as team on team.id = member.fantasy_team_id
      where member.private_league_id = league_id and team.user_id = auth.uid()
    )
  );

grant select on public.league_regulations to authenticated;
