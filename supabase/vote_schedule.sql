-- Letture dei voti a orari fissi.
-- Eseguilo nell'editor SQL di Supabase PRIMA di pubblicare il codice che lo usa.
-- Aggiunge soltanto: non cancella tabelle, colonne o righe. Si può rieseguire.

begin;

-- 1. Interruttore del Laboratorio per la lettura di fine primo tempo.
alter table public.system_settings
  add column if not exists halftime_read_enabled boolean not null default true;

-- 2. Rinvii: l'orario che la partita aveva quando è stata segnata rinviata.
--    Quando l'orario cambia, le letture ripartono.
alter table public.real_matches
  add column if not exists postponed boolean not null default false;
alter table public.real_matches
  add column if not exists hold_status text not null default 'none';
alter table public.real_matches
  add column if not exists hold_kickoff_at timestamptz;

-- Le partite già segnate rinviate o sospese partono dall'orario attuale.
update public.real_matches
set hold_kickoff_at = kickoff_at
where (postponed = true or hold_status <> 'none')
  and hold_kickoff_at is null;

-- 3. Registro dei tentativi: una riga per lettura. La chiave impedisce i doppioni,
--    anche se due sveglie chiamano insieme. attempt = 0 vuol dire "avviso già inviato".
create table if not exists public.vote_reads (
  task_key     text not null,
  attempt      smallint not null check (attempt between 0 and 2),
  gameweek_id  uuid references public.gameweeks (id) on delete cascade,
  kind         text not null check (kind in ('halftime', 'fulltime', 'morning', 'calendar', 'calc')),
  outcome      text not null default 'pending' check (outcome in ('pending', 'ok', 'not_ready', 'error', 'alert')),
  detail       text not null default '',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  primary key (task_key, attempt)
);

create index if not exists vote_reads_started_at on public.vote_reads (started_at desc);

alter table public.vote_reads enable row level security;
revoke all on table public.vote_reads from public, anon, authenticated;
grant select, insert, update, delete on table public.vote_reads to service_role;

-- 4. L'unica lettura che la sveglia fa quando non c'è niente da fare.
create or replace function public.vote_clock()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'auto', coalesce((select s.auto_sync_enabled from public.system_settings s where s.id = 1), true),
    'halftime', coalesce((select s.halftime_read_enabled from public.system_settings s where s.id = 1), true),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'number', g.number,
        'status', g.status::text,
        'seasonCode', se.code,
        'matches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id,
            'kickoffAt', m.kickoff_at,
            'status', m.status::text,
            'home', lower(h.code),
            'away', lower(a.code),
            'homeClubId', m.home_club_id,
            'awayClubId', m.away_club_id,
            'postponed', m.postponed,
            'holdStatus', m.hold_status,
            'holdKickoffAt', m.hold_kickoff_at
          ) order by m.kickoff_at, m.id)
          from public.real_matches m
          join public.clubs h on h.id = m.home_club_id
          join public.clubs a on a.id = m.away_club_id
          where m.gameweek_id = g.id
        ), '[]'::jsonb)
      ) order by g.number)
      from public.gameweeks g
      join public.seasons se on se.id = g.season_id
      join public.competitions c on c.id = se.competition_id
      where c.code = 'serie_a'
        and se.code <> 'sandbox'
        and g.status::text <> 'final'
        and exists (
          select 1 from public.real_matches r
          where r.gameweek_id = g.id
            and r.kickoff_at between now() - interval '10 days' and now() + interval '1 day'
        )
    ), '[]'::jsonb),
    'reads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', v.task_key,
        'attempt', v.attempt,
        'weekId', v.gameweek_id,
        'kind', v.kind,
        'outcome', v.outcome,
        'startedAt', v.started_at,
        'finishedAt', v.finished_at
      ))
      from public.vote_reads v
      where v.started_at > now() - interval '45 days'
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.vote_clock() from public, anon, authenticated;
grant execute on function public.vote_clock() to service_role;

commit;

notify pgrst, 'reload schema';
