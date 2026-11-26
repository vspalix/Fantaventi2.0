-- Fantaventi — seed iniziale
-- Eseguire nell'editor SQL di Supabase dopo la creazione dello schema del PRD
-- (enum, tabelle, vincoli unique). Lo script è ripetibile: un secondo passaggio
-- aggiorna ruleset, stagione, nomi e registrazioni senza duplicare le righe.
--
-- Stagione: Serie A 2026-27 (22 agosto 2026 – 30 maggio 2027), stato running.
-- Il listone di test ha 120 calciatori reali, sei per ciascuno dei 20 club,
-- con i quattro ruoli coperti in ogni squadra.
-- La rosa fantacalcio resta di un calciatore per club.

begin;

-- ---------------------------------------------------------------------------
-- 1. Competizione
-- ---------------------------------------------------------------------------

insert into public.competitions (id, code, country_code)
values ('11111111-1111-4111-8111-111111111111', 'serie_a', 'IT')
on conflict (code) do update
set country_code = excluded.country_code;

insert into public.competition_translations (competition_id, locale, name)
select c.id, v.locale, v.name
from public.competitions c
cross join (
  values
    ('it', 'Serie A'),
    ('en', 'Serie A')
) as v(locale, name)
where c.code = 'serie_a'
on conflict (competition_id, locale) do update
set name = excluded.name;

-- ---------------------------------------------------------------------------
-- 2. Ruleset ufficiale fantaventi, versione 1
--    JSONB della sezione 8.4 del PRD.
--    penalty_scored non c'è: il rigore segnato resta contato in goal
--    finché la decisione aperta n. 3 non viene chiusa.
-- ---------------------------------------------------------------------------

insert into public.rulesets (id, code, version, definition)
values (
  '22222222-2222-4222-8222-222222222222',
  'fantaventi',
  1,
  $json${
  "squad_size": 20,
  "goalkeepers": { "min": 2, "max": 3 },
  "outfield_roles": { "min": 3, "max": 9 },
  "lineup_size": 11,
  "captain_modifier": [
    { "max_exclusive": 6, "points": -0.5 },
    { "eq": 6, "points": 0.5 },
    { "eq": 6.5, "points": 1 },
    { "eq": 7, "points": 1.5 },
    { "min_inclusive": 7.5, "points": 2 }
  ],
  "double_captain_malus": true,
  "fair_play": { "points": 2.5, "cards": ["yellow_card"] },
  "defense_modifier": {
    "basis": "voto",
    "min_rated_defenders": 4,
    "best_defenders": 3,
    "bands": [
      { "min": 6.0, "points": 1 },
      { "min": 6.5, "points": 3 },
      { "min": 7.0, "points": 6 }
    ]
  },
  "empty_slot_points": 2.5,
  "checkpoints": { "count": 3, "first_gameweek": 2, "max_replacements": 4 },
  "bonus_malus": {
    "yellow_card": -0.5,
    "red_card": -1,
    "goal": 3,
    "assist": 1,
    "penalty_missed": -3,
    "penalty_saved": 3,
    "own_goal": -2,
    "goal_conceded": -1
  }
}$json$::jsonb
)
on conflict (code, version) do update
set definition = excluded.definition;

-- ---------------------------------------------------------------------------
-- 3. Stagione corrente
-- ---------------------------------------------------------------------------

insert into public.seasons (
  id,
  competition_id,
  ruleset_id,
  code,
  status,
  starts_on,
  ends_on
)
select
  '33333333-3333-4333-8333-333333333333',
  c.id,
  r.id,
  '2026-27',
  'running'::public.season_status,
  date '2026-08-22',
  date '2027-05-30'
from public.competitions c
join public.rulesets r
  on r.code = 'fantaventi'
 and r.version = 1
where c.code = 'serie_a'
on conflict (competition_id, code) do update
set
  ruleset_id = excluded.ruleset_id,
  status = excluded.status,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on;

-- ---------------------------------------------------------------------------
-- 4. Venti club della Serie A 2026-27 e iscrizione alla stagione
--    Retrocessi dalla stagione precedente: Pisa, Cremonese, Hellas Verona.
--    Promossi: Venezia, Frosinone, Monza.
-- ---------------------------------------------------------------------------

insert into public.clubs (id, competition_id, code)
select v.id, c.id, v.code
from public.competitions c
cross join (
  values
    ('44444444-4444-4444-8444-000000000001'::uuid, 'atalanta'),
    ('44444444-4444-4444-8444-000000000002'::uuid, 'bologna'),
    ('44444444-4444-4444-8444-000000000003'::uuid, 'cagliari'),
    ('44444444-4444-4444-8444-000000000004'::uuid, 'como'),
    ('44444444-4444-4444-8444-000000000005'::uuid, 'fiorentina'),
    ('44444444-4444-4444-8444-000000000006'::uuid, 'frosinone'),
    ('44444444-4444-4444-8444-000000000007'::uuid, 'genoa'),
    ('44444444-4444-4444-8444-000000000008'::uuid, 'inter'),
    ('44444444-4444-4444-8444-000000000009'::uuid, 'juventus'),
    ('44444444-4444-4444-8444-000000000010'::uuid, 'lazio'),
    ('44444444-4444-4444-8444-000000000011'::uuid, 'lecce'),
    ('44444444-4444-4444-8444-000000000012'::uuid, 'milan'),
    ('44444444-4444-4444-8444-000000000013'::uuid, 'monza'),
    ('44444444-4444-4444-8444-000000000014'::uuid, 'napoli'),
    ('44444444-4444-4444-8444-000000000015'::uuid, 'parma'),
    ('44444444-4444-4444-8444-000000000016'::uuid, 'roma'),
    ('44444444-4444-4444-8444-000000000017'::uuid, 'sassuolo'),
    ('44444444-4444-4444-8444-000000000018'::uuid, 'torino'),
    ('44444444-4444-4444-8444-000000000019'::uuid, 'udinese'),
    ('44444444-4444-4444-8444-000000000020'::uuid, 'venezia')
) as v(id, code)
where c.code = 'serie_a'
on conflict (competition_id, code) do nothing;

insert into public.club_translations (club_id, locale, name, short_name)
select cl.id, v.locale, v.name, v.short_name
from public.clubs cl
join public.competitions c on c.id = cl.competition_id
join (
  values
    ('atalanta',   'it', 'Atalanta',    'ATA'),
    ('atalanta',   'en', 'Atalanta',    'ATA'),
    ('bologna',    'it', 'Bologna',     'BOL'),
    ('bologna',    'en', 'Bologna',     'BOL'),
    ('cagliari',   'it', 'Cagliari',    'CAG'),
    ('cagliari',   'en', 'Cagliari',    'CAG'),
    ('como',       'it', 'Como',        'COM'),
    ('como',       'en', 'Como',        'COM'),
    ('fiorentina', 'it', 'Fiorentina',  'FIO'),
    ('fiorentina', 'en', 'Fiorentina',  'FIO'),
    ('frosinone',  'it', 'Frosinone',   'FRO'),
    ('frosinone',  'en', 'Frosinone',   'FRO'),
    ('genoa',      'it', 'Genoa',       'GEN'),
    ('genoa',      'en', 'Genoa',       'GEN'),
    ('inter',      'it', 'Inter',       'INT'),
    ('inter',      'en', 'Inter',       'INT'),
    ('juventus',   'it', 'Juventus',    'JUV'),
    ('juventus',   'en', 'Juventus',    'JUV'),
    ('lazio',      'it', 'Lazio',       'LAZ'),
    ('lazio',      'en', 'Lazio',       'LAZ'),
    ('lecce',      'it', 'Lecce',       'LEC'),
    ('lecce',      'en', 'Lecce',       'LEC'),
    ('milan',      'it', 'Milan',       'MIL'),
    ('milan',      'en', 'Milan',       'MIL'),
    ('monza',      'it', 'Monza',       'MON'),
    ('monza',      'en', 'Monza',       'MON'),
    ('napoli',     'it', 'Napoli',      'NAP'),
    ('napoli',     'en', 'Napoli',      'NAP'),
    ('parma',      'it', 'Parma',       'PAR'),
    ('parma',      'en', 'Parma',       'PAR'),
    ('roma',       'it', 'Roma',        'ROM'),
    ('roma',       'en', 'Roma',        'ROM'),
    ('sassuolo',   'it', 'Sassuolo',    'SAS'),
    ('sassuolo',   'en', 'Sassuolo',    'SAS'),
    ('torino',     'it', 'Torino',      'TOR'),
    ('torino',     'en', 'Torino',      'TOR'),
    ('udinese',    'it', 'Udinese',     'UDI'),
    ('udinese',    'en', 'Udinese',     'UDI'),
    ('venezia',    'it', 'Venezia',     'VEN'),
    ('venezia',    'en', 'Venezia',     'VEN')
) as v(code, locale, name, short_name)
  on v.code = cl.code
where c.code = 'serie_a'
on conflict (club_id, locale) do update
set
  name = excluded.name,
  short_name = excluded.short_name;

insert into public.season_clubs (season_id, club_id)
select s.id, cl.id
from public.seasons s
join public.competitions c on c.id = s.competition_id
join public.clubs cl on cl.competition_id = c.id
where c.code = 'serie_a'
  and s.code = '2026-27'
on conflict (season_id, club_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Listone di test: 120 calciatori, sei per club, quattro ruoli
--    external_ref è una chiave di seed, non l'id fantacalcio.it.
--    effective_from_gameweek = 1, effective_to_gameweek nullo (intera stagione).
-- ---------------------------------------------------------------------------

insert into public.players (id, external_ref, full_name, competition_id)
select v.id::uuid, v.external_ref, v.full_name, c.id
from (values
  ('55555555-5555-4555-8555-000000000001', 'seed:marco-carnesecchi',   'Marco Carnesecchi'),
  ('55555555-5555-4555-8555-000000000002', 'seed:rasmus-kristensen',    'Rasmus Kristensen'),
  ('55555555-5555-4555-8555-000000000003', 'seed:nikola-krstovic',      'Nikola Krstović'),
  ('55555555-5555-4555-8555-000000000004', 'seed:arthur-theate',        'Arthur Theate'),
  ('55555555-5555-4555-8555-000000000005', 'seed:artem-dovbyk',         'Artem Dovbyk'),
  ('55555555-5555-4555-8555-000000000006', 'seed:daniel-maldini',       'Daniel Maldini'),
  ('55555555-5555-4555-8555-000000000007', 'seed:robert-sanchez',       'Robert Sánchez'),
  ('55555555-5555-4555-8555-000000000008', 'seed:samuele-ricci',        'Samuele Ricci'),
  ('55555555-5555-4555-8555-000000000009', 'seed:moise-kean',           'Moise Kean'),
  ('55555555-5555-4555-8555-000000000010', 'seed:radu-dragusin',        'Radu Drăgușin'),
  ('55555555-5555-4555-8555-000000000011', 'seed:franco-mastantuono',   'Franco Mastantuono'),
  ('55555555-5555-4555-8555-000000000012', 'seed:florian-grillitsch',   'Florian Grillitsch'),
  ('55555555-5555-4555-8555-000000000013', 'seed:antonio-raimondo',     'Antonio Raimondo'),
  ('55555555-5555-4555-8555-000000000014', 'seed:milutin-osmajic',      'Milutin Osmajić'),
  ('55555555-5555-4555-8555-000000000015', 'seed:ivan-provedel',        'Ivan Provedel'),
  ('55555555-5555-4555-8555-000000000016', 'seed:john-stones',          'John Stones'),
  ('55555555-5555-4555-8555-000000000017', 'seed:curtis-jones',         'Curtis Jones'),
  ('55555555-5555-4555-8555-000000000018', 'seed:lautaro-martinez',     'Lautaro Martínez'),
  ('55555555-5555-4555-8555-000000000019', 'seed:guglielmo-vicario',    'Guglielmo Vicario'),
  ('55555555-5555-4555-8555-000000000020', 'seed:zeki-celik',           'Zeki Çelik'),
  ('55555555-5555-4555-8555-000000000021', 'seed:randal-kolo-muani',    'Randal Kolo Muani'),
  ('55555555-5555-4555-8555-000000000022', 'seed:josip-sutalo',         'Josip Šutalo'),
  ('55555555-5555-4555-8555-000000000023', 'seed:davide-frattesi',      'Davide Frattesi'),
  ('55555555-5555-4555-8555-000000000024', 'seed:santiago-pierotti',    'Santiago Pierotti'),
  ('55555555-5555-4555-8555-000000000025', 'seed:mike-maignan',         'Mike Maignan'),
  ('55555555-5555-4555-8555-000000000026', 'seed:mario-gila',           'Mario Gila'),
  ('55555555-5555-4555-8555-000000000027', 'seed:goncalo-ramos',        'Gonçalo Ramos'),
  ('55555555-5555-4555-8555-000000000028', 'seed:michael-folorunsho',   'Michael Folorunsho'),
  ('55555555-5555-4555-8555-000000000029', 'seed:gustavo-varela',       'Gustavo Varela'),
  ('55555555-5555-4555-8555-000000000030', 'seed:benoit-badiashile',    'Benoît Badiashile'),
  ('55555555-5555-4555-8555-000000000031', 'seed:kevin-de-bruyne',      'Kevin De Bruyne'),
  ('55555555-5555-4555-8555-000000000032', 'seed:adrian-bernabe',       'Adrián Bernabé'),
  ('55555555-5555-4555-8555-000000000033', 'seed:mile-svilar',          'Mile Svilar'),
  ('55555555-5555-4555-8555-000000000034', 'seed:leonardo-balerdi',     'Leonardo Balerdi'),
  ('55555555-5555-4555-8555-000000000035', 'seed:donyell-malen',        'Donyell Malen'),
  ('55555555-5555-4555-8555-000000000036', 'seed:cristian-volpato',     'Cristian Volpato'),
  ('55555555-5555-4555-8555-000000000037', 'seed:rolando-mandragora',   'Rolando Mandragora'),
  ('55555555-5555-4555-8555-000000000038', 'seed:che-adams',            'Ché Adams'),
  ('55555555-5555-4555-8555-000000000039', 'seed:mergim-vojvoda',       'Mergim Vojvoda'),
  ('55555555-5555-4555-8555-000000000040', 'seed:juan-jesus',           'Juan Jesus')
) as v(id, external_ref, full_name)
cross join public.competitions c
where c.code = 'serie_a'
on conflict (competition_id, external_ref) do update
set full_name = excluded.full_name;

insert into public.player_registrations (
  id,
  season_id,
  player_id,
  club_id,
  role,
  effective_from_gameweek,
  effective_to_gameweek
)
select
  v.registration_id,
  s.id,
  p.id,
  cl.id,
  v.role::public.player_role,
  1,
  null
from (
  values
    ('66666666-6666-4666-8666-000000000001'::uuid, 'seed:marco-carnesecchi',  'atalanta',   'GK'),
    ('66666666-6666-4666-8666-000000000002'::uuid, 'seed:rasmus-kristensen',   'atalanta',   'DEF'),
    ('66666666-6666-4666-8666-000000000003'::uuid, 'seed:nikola-krstovic',     'atalanta',   'FWD'),
    ('66666666-6666-4666-8666-000000000004'::uuid, 'seed:arthur-theate',       'bologna',    'DEF'),
    ('66666666-6666-4666-8666-000000000005'::uuid, 'seed:artem-dovbyk',        'bologna',    'FWD'),
    ('66666666-6666-4666-8666-000000000006'::uuid, 'seed:daniel-maldini',      'cagliari',   'FWD'),
    ('66666666-6666-4666-8666-000000000007'::uuid, 'seed:robert-sanchez',      'como',       'GK'),
    ('66666666-6666-4666-8666-000000000008'::uuid, 'seed:samuele-ricci',       'como',       'MID'),
    ('66666666-6666-4666-8666-000000000009'::uuid, 'seed:moise-kean',          'como',       'FWD'),
    ('66666666-6666-4666-8666-000000000010'::uuid, 'seed:radu-dragusin',       'fiorentina', 'DEF'),
    ('66666666-6666-4666-8666-000000000011'::uuid, 'seed:franco-mastantuono',  'fiorentina', 'MID'),
    ('66666666-6666-4666-8666-000000000012'::uuid, 'seed:florian-grillitsch',  'frosinone',  'MID'),
    ('66666666-6666-4666-8666-000000000013'::uuid, 'seed:antonio-raimondo',    'frosinone',  'FWD'),
    ('66666666-6666-4666-8666-000000000014'::uuid, 'seed:milutin-osmajic',     'genoa',      'FWD'),
    ('66666666-6666-4666-8666-000000000015'::uuid, 'seed:ivan-provedel',       'inter',      'GK'),
    ('66666666-6666-4666-8666-000000000016'::uuid, 'seed:john-stones',         'inter',      'DEF'),
    ('66666666-6666-4666-8666-000000000017'::uuid, 'seed:curtis-jones',        'inter',      'MID'),
    ('66666666-6666-4666-8666-000000000018'::uuid, 'seed:lautaro-martinez',    'inter',      'FWD'),
    ('66666666-6666-4666-8666-000000000019'::uuid, 'seed:guglielmo-vicario',   'juventus',   'GK'),
    ('66666666-6666-4666-8666-000000000020'::uuid, 'seed:zeki-celik',          'juventus',   'DEF'),
    ('66666666-6666-4666-8666-000000000021'::uuid, 'seed:randal-kolo-muani',   'juventus',   'FWD'),
    ('66666666-6666-4666-8666-000000000022'::uuid, 'seed:josip-sutalo',        'lazio',      'DEF'),
    ('66666666-6666-4666-8666-000000000023'::uuid, 'seed:davide-frattesi',     'lazio',      'MID'),
    ('66666666-6666-4666-8666-000000000024'::uuid, 'seed:santiago-pierotti',   'lecce',      'FWD'),
    ('66666666-6666-4666-8666-000000000025'::uuid, 'seed:mike-maignan',        'milan',      'GK'),
    ('66666666-6666-4666-8666-000000000026'::uuid, 'seed:mario-gila',          'milan',      'DEF'),
    ('66666666-6666-4666-8666-000000000027'::uuid, 'seed:goncalo-ramos',       'milan',      'FWD'),
    ('66666666-6666-4666-8666-000000000028'::uuid, 'seed:michael-folorunsho',  'monza',      'MID'),
    ('66666666-6666-4666-8666-000000000029'::uuid, 'seed:gustavo-varela',      'monza',      'FWD'),
    ('66666666-6666-4666-8666-000000000030'::uuid, 'seed:benoit-badiashile',   'napoli',     'DEF'),
    ('66666666-6666-4666-8666-000000000031'::uuid, 'seed:kevin-de-bruyne',     'napoli',     'MID'),
    ('66666666-6666-4666-8666-000000000032'::uuid, 'seed:adrian-bernabe',      'parma',      'MID'),
    ('66666666-6666-4666-8666-000000000033'::uuid, 'seed:mile-svilar',         'roma',       'GK'),
    ('66666666-6666-4666-8666-000000000034'::uuid, 'seed:leonardo-balerdi',    'roma',       'DEF'),
    ('66666666-6666-4666-8666-000000000035'::uuid, 'seed:donyell-malen',       'roma',       'FWD'),
    ('66666666-6666-4666-8666-000000000036'::uuid, 'seed:cristian-volpato',    'sassuolo',   'MID'),
    ('66666666-6666-4666-8666-000000000037'::uuid, 'seed:rolando-mandragora',  'torino',     'MID'),
    ('66666666-6666-4666-8666-000000000038'::uuid, 'seed:che-adams',           'torino',     'FWD'),
    ('66666666-6666-4666-8666-000000000039'::uuid, 'seed:mergim-vojvoda',      'udinese',    'DEF'),
    ('66666666-6666-4666-8666-000000000040'::uuid, 'seed:juan-jesus',          'venezia',    'DEF')
) as v(registration_id, external_ref, club_code, role)
join public.players p on p.external_ref = v.external_ref and p.competition_id = c.id
join public.competitions c on c.code = 'serie_a'
join public.seasons s
  on s.competition_id = c.id
 and s.code = '2026-27'
join public.clubs cl
  on cl.competition_id = c.id
 and cl.code = v.club_code
on conflict (season_id, player_id, effective_from_gameweek) do update
set
  club_id = excluded.club_id,
  role = excluded.role,
  effective_to_gameweek = excluded.effective_to_gameweek;

insert into public.players (id, external_ref, full_name, competition_id)
select v.id::uuid, v.external_ref, v.full_name, c.id
from (values
  ('55555555-5555-4555-8555-000000000041', 'seed:ademola-lookman', 'Ademola Lookman'),
  ('55555555-5555-4555-8555-000000000042', 'seed:ederson-atalanta', 'Ederson'),
  ('55555555-5555-4555-8555-000000000043', 'seed:berat-djimsiti', 'Berat Djimsiti'),
  ('55555555-5555-4555-8555-000000000044', 'seed:lukasz-skorupski', 'Lukasz Skorupski'),
  ('55555555-5555-4555-8555-000000000045', 'seed:remo-freuler', 'Remo Freuler'),
  ('55555555-5555-4555-8555-000000000046', 'seed:jhon-lucumi', 'Jhon Lucumi'),
  ('55555555-5555-4555-8555-000000000047', 'seed:riccardo-orsolini', 'Riccardo Orsolini'),
  ('55555555-5555-4555-8555-000000000048', 'seed:elia-caprile', 'Elia Caprile'),
  ('55555555-5555-4555-8555-000000000049', 'seed:gabriele-zappa', 'Gabriele Zappa'),
  ('55555555-5555-4555-8555-000000000050', 'seed:yerry-mina', 'Yerry Mina'),
  ('55555555-5555-4555-8555-000000000051', 'seed:antoine-makoumbou', 'Antoine Makoumbou'),
  ('55555555-5555-4555-8555-000000000052', 'seed:roberto-piccoli', 'Roberto Piccoli'),
  ('55555555-5555-4555-8555-000000000053', 'seed:edoardo-goldaniga', 'Edoardo Goldaniga'),
  ('55555555-5555-4555-8555-000000000054', 'seed:nico-paz', 'Nico Paz'),
  ('55555555-5555-4555-8555-000000000055', 'seed:alberto-cerri', 'Alberto Cerri'),
  ('55555555-5555-4555-8555-000000000056', 'seed:david-de-gea', 'David de Gea'),
  ('55555555-5555-4555-8555-000000000057', 'seed:fabiano-parisi', 'Fabiano Parisi'),
  ('55555555-5555-4555-8555-000000000058', 'seed:lucas-beltran', 'Lucas Beltran'),
  ('55555555-5555-4555-8555-000000000059', 'seed:albert-gudmundsson', 'Albert Gudmundsson'),
  ('55555555-5555-4555-8555-000000000060', 'seed:stefano-turati', 'Stefano Turati'),
  ('55555555-5555-4555-8555-000000000061', 'seed:ilario-monterisi', 'Ilario Monterisi'),
  ('55555555-5555-4555-8555-000000000062', 'seed:reinier', 'Reinier'),
  ('55555555-5555-4555-8555-000000000063', 'seed:giuseppe-caso', 'Giuseppe Caso'),
  ('55555555-5555-4555-8555-000000000064', 'seed:nicola-leali', 'Nicola Leali'),
  ('55555555-5555-4555-8555-000000000065', 'seed:johan-vasquez', 'Johan Vasquez'),
  ('55555555-5555-4555-8555-000000000066', 'seed:morten-frendrup', 'Morten Frendrup'),
  ('55555555-5555-4555-8555-000000000067', 'seed:vitinha-genoa', 'Vitinha'),
  ('55555555-5555-4555-8555-000000000068', 'seed:andrea-pinamonti', 'Andrea Pinamonti'),
  ('55555555-5555-4555-8555-000000000069', 'seed:alessandro-bastoni', 'Alessandro Bastoni'),
  ('55555555-5555-4555-8555-000000000070', 'seed:nicolo-barella', 'Nicolo Barella'),
  ('55555555-5555-4555-8555-000000000071', 'seed:manuel-locatelli', 'Manuel Locatelli'),
  ('55555555-5555-4555-8555-000000000072', 'seed:federico-gatti', 'Federico Gatti'),
  ('55555555-5555-4555-8555-000000000073', 'seed:kenan-yildiz', 'Kenan Yildiz'),
  ('55555555-5555-4555-8555-000000000074', 'seed:christos-mandas', 'Christos Mandas'),
  ('55555555-5555-4555-8555-000000000075', 'seed:elseid-hysaj', 'Elseid Hysaj'),
  ('55555555-5555-4555-8555-000000000076', 'seed:mattia-zaccagni', 'Mattia Zaccagni'),
  ('55555555-5555-4555-8555-000000000077', 'seed:tijjani-noslin', 'Tijjani Noslin'),
  ('55555555-5555-4555-8555-000000000078', 'seed:wladimiro-falcone', 'Wladimiro Falcone'),
  ('55555555-5555-4555-8555-000000000079', 'seed:federico-baschirotto', 'Federico Baschirotto'),
  ('55555555-5555-4555-8555-000000000080', 'seed:ylber-ramadani', 'Ylber Ramadani'),
  ('55555555-5555-4555-8555-000000000081', 'seed:thorir-helgason', 'Thorir Helgason'),
  ('55555555-5555-4555-8555-000000000082', 'seed:nicola-sansone', 'Nicola Sansone'),
  ('55555555-5555-4555-8555-000000000083', 'seed:christian-pulisic', 'Christian Pulisic'),
  ('55555555-5555-4555-8555-000000000084', 'seed:fikayo-tomori', 'Fikayo Tomori'),
  ('55555555-5555-4555-8555-000000000085', 'seed:ruben-loftus-cheek', 'Ruben Loftus-Cheek'),
  ('55555555-5555-4555-8555-000000000086', 'seed:semuel-pizzignacco', 'Semuel Pizzignacco'),
  ('55555555-5555-4555-8555-000000000087', 'seed:armando-izzo', 'Armando Izzo'),
  ('55555555-5555-4555-8555-000000000088', 'seed:matteo-pessina', 'Matteo Pessina'),
  ('55555555-5555-4555-8555-000000000089', 'seed:milan-djuric', 'Milan Djuric'),
  ('55555555-5555-4555-8555-000000000090', 'seed:alex-meret', 'Alex Meret'),
  ('55555555-5555-4555-8555-000000000091', 'seed:giovanni-di-lorenzo', 'Giovanni Di Lorenzo'),
  ('55555555-5555-4555-8555-000000000092', 'seed:romelu-lukaku', 'Romelu Lukaku'),
  ('55555555-5555-4555-8555-000000000093', 'seed:scott-mctominay', 'Scott McTominay'),
  ('55555555-5555-4555-8555-000000000094', 'seed:zion-suzuki', 'Zion Suzuki'),
  ('55555555-5555-4555-8555-000000000095', 'seed:enrico-delprato', 'Enrico Delprato'),
  ('55555555-5555-4555-8555-000000000096', 'seed:antoine-hainaut', 'Antoine Hainaut'),
  ('55555555-5555-4555-8555-000000000097', 'seed:mateo-pellegrino', 'Mateo Pellegrino'),
  ('55555555-5555-4555-8555-000000000098', 'seed:pontus-almqvist', 'Pontus Almqvist'),
  ('55555555-5555-4555-8555-000000000099', 'seed:lorenzo-pellegrini', 'Lorenzo Pellegrini'),
  ('55555555-5555-4555-8555-000000000100', 'seed:evan-ndicka', 'Evan Ndicka'),
  ('55555555-5555-4555-8555-000000000101', 'seed:matias-soule', 'Matias Soule'),
  ('55555555-5555-4555-8555-000000000102', 'seed:andrea-consigli', 'Andrea Consigli'),
  ('55555555-5555-4555-8555-000000000103', 'seed:tarik-muharemovic', 'Tarik Muharemovic'),
  ('55555555-5555-4555-8555-000000000104', 'seed:kristian-thorstvedt', 'Kristian Thorstvedt'),
  ('55555555-5555-4555-8555-000000000105', 'seed:armand-lauriente', 'Armand Lauriente'),
  ('55555555-5555-4555-8555-000000000106', 'seed:samuele-mulattieri', 'Samuele Mulattieri'),
  ('55555555-5555-4555-8555-000000000107', 'seed:vanja-milinkovic-savic', 'Vanja Milinkovic-Savic'),
  ('55555555-5555-4555-8555-000000000108', 'seed:alessandro-buongiorno', 'Alessandro Buongiorno'),
  ('55555555-5555-4555-8555-000000000109', 'seed:nikola-vlasic', 'Nikola Vlasic'),
  ('55555555-5555-4555-8555-000000000110', 'seed:duvan-zapata', 'Duvan Zapata'),
  ('55555555-5555-4555-8555-000000000111', 'seed:maduka-okoye', 'Maduka Okoye'),
  ('55555555-5555-4555-8555-000000000112', 'seed:jaka-bijol', 'Jaka Bijol'),
  ('55555555-5555-4555-8555-000000000113', 'seed:lazar-samardzic', 'Lazar Samardzic'),
  ('55555555-5555-4555-8555-000000000114', 'seed:lorenzo-lucca', 'Lorenzo Lucca'),
  ('55555555-5555-4555-8555-000000000115', 'seed:florian-thauvin', 'Florian Thauvin'),
  ('55555555-5555-4555-8555-000000000116', 'seed:filip-stankovic', 'Filip Stankovic'),
  ('55555555-5555-4555-8555-000000000117', 'seed:jay-idzes', 'Jay Idzes'),
  ('55555555-5555-4555-8555-000000000118', 'seed:hans-nicolussi', 'Hans Nicolussi Caviglia'),
  ('55555555-5555-4555-8555-000000000119', 'seed:gaetano-oristanio', 'Gaetano Oristanio'),
  ('55555555-5555-4555-8555-000000000120', 'seed:joel-pohjanpalo', 'Joel Pohjanpalo')
) as v(id, external_ref, full_name)
cross join public.competitions c
where c.code = 'serie_a'
on conflict (competition_id, external_ref) do update
set full_name = excluded.full_name;

insert into public.player_registrations (
  id, season_id, player_id, club_id, role, effective_from_gameweek, effective_to_gameweek
)
select
  v.registration_id, s.id, p.id, cl.id, v.role::public.player_role, 1, null
from (
  values
    ('66666666-6666-4666-8666-000000000041'::uuid, 'seed:ademola-lookman', 'atalanta', 'FWD'),
    ('66666666-6666-4666-8666-000000000042'::uuid, 'seed:ederson-atalanta', 'atalanta', 'MID'),
    ('66666666-6666-4666-8666-000000000043'::uuid, 'seed:berat-djimsiti', 'atalanta', 'DEF'),
    ('66666666-6666-4666-8666-000000000044'::uuid, 'seed:lukasz-skorupski', 'bologna', 'GK'),
    ('66666666-6666-4666-8666-000000000045'::uuid, 'seed:remo-freuler', 'bologna', 'MID'),
    ('66666666-6666-4666-8666-000000000046'::uuid, 'seed:jhon-lucumi', 'bologna', 'DEF'),
    ('66666666-6666-4666-8666-000000000047'::uuid, 'seed:riccardo-orsolini', 'bologna', 'FWD'),
    ('66666666-6666-4666-8666-000000000048'::uuid, 'seed:elia-caprile', 'cagliari', 'GK'),
    ('66666666-6666-4666-8666-000000000049'::uuid, 'seed:gabriele-zappa', 'cagliari', 'DEF'),
    ('66666666-6666-4666-8666-000000000050'::uuid, 'seed:yerry-mina', 'cagliari', 'DEF'),
    ('66666666-6666-4666-8666-000000000051'::uuid, 'seed:antoine-makoumbou', 'cagliari', 'MID'),
    ('66666666-6666-4666-8666-000000000052'::uuid, 'seed:roberto-piccoli', 'cagliari', 'FWD'),
    ('66666666-6666-4666-8666-000000000053'::uuid, 'seed:edoardo-goldaniga', 'como', 'DEF'),
    ('66666666-6666-4666-8666-000000000054'::uuid, 'seed:nico-paz', 'como', 'MID'),
    ('66666666-6666-4666-8666-000000000055'::uuid, 'seed:alberto-cerri', 'como', 'FWD'),
    ('66666666-6666-4666-8666-000000000056'::uuid, 'seed:david-de-gea', 'fiorentina', 'GK'),
    ('66666666-6666-4666-8666-000000000057'::uuid, 'seed:fabiano-parisi', 'fiorentina', 'DEF'),
    ('66666666-6666-4666-8666-000000000058'::uuid, 'seed:lucas-beltran', 'fiorentina', 'MID'),
    ('66666666-6666-4666-8666-000000000059'::uuid, 'seed:albert-gudmundsson', 'fiorentina', 'FWD'),
    ('66666666-6666-4666-8666-000000000060'::uuid, 'seed:stefano-turati', 'frosinone', 'GK'),
    ('66666666-6666-4666-8666-000000000061'::uuid, 'seed:ilario-monterisi', 'frosinone', 'DEF'),
    ('66666666-6666-4666-8666-000000000062'::uuid, 'seed:reinier', 'frosinone', 'MID'),
    ('66666666-6666-4666-8666-000000000063'::uuid, 'seed:giuseppe-caso', 'frosinone', 'FWD'),
    ('66666666-6666-4666-8666-000000000064'::uuid, 'seed:nicola-leali', 'genoa', 'GK'),
    ('66666666-6666-4666-8666-000000000065'::uuid, 'seed:johan-vasquez', 'genoa', 'DEF'),
    ('66666666-6666-4666-8666-000000000066'::uuid, 'seed:morten-frendrup', 'genoa', 'MID'),
    ('66666666-6666-4666-8666-000000000067'::uuid, 'seed:vitinha-genoa', 'genoa', 'MID'),
    ('66666666-6666-4666-8666-000000000068'::uuid, 'seed:andrea-pinamonti', 'genoa', 'FWD'),
    ('66666666-6666-4666-8666-000000000069'::uuid, 'seed:alessandro-bastoni', 'inter', 'DEF'),
    ('66666666-6666-4666-8666-000000000070'::uuid, 'seed:nicolo-barella', 'inter', 'MID'),
    ('66666666-6666-4666-8666-000000000071'::uuid, 'seed:manuel-locatelli', 'juventus', 'MID'),
    ('66666666-6666-4666-8666-000000000072'::uuid, 'seed:federico-gatti', 'juventus', 'DEF'),
    ('66666666-6666-4666-8666-000000000073'::uuid, 'seed:kenan-yildiz', 'juventus', 'FWD'),
    ('66666666-6666-4666-8666-000000000074'::uuid, 'seed:christos-mandas', 'lazio', 'GK'),
    ('66666666-6666-4666-8666-000000000075'::uuid, 'seed:elseid-hysaj', 'lazio', 'DEF'),
    ('66666666-6666-4666-8666-000000000076'::uuid, 'seed:mattia-zaccagni', 'lazio', 'MID'),
    ('66666666-6666-4666-8666-000000000077'::uuid, 'seed:tijjani-noslin', 'lazio', 'FWD'),
    ('66666666-6666-4666-8666-000000000078'::uuid, 'seed:wladimiro-falcone', 'lecce', 'GK'),
    ('66666666-6666-4666-8666-000000000079'::uuid, 'seed:federico-baschirotto', 'lecce', 'DEF'),
    ('66666666-6666-4666-8666-000000000080'::uuid, 'seed:ylber-ramadani', 'lecce', 'MID'),
    ('66666666-6666-4666-8666-000000000081'::uuid, 'seed:thorir-helgason', 'lecce', 'MID'),
    ('66666666-6666-4666-8666-000000000082'::uuid, 'seed:nicola-sansone', 'lecce', 'FWD'),
    ('66666666-6666-4666-8666-000000000083'::uuid, 'seed:christian-pulisic', 'milan', 'MID'),
    ('66666666-6666-4666-8666-000000000084'::uuid, 'seed:fikayo-tomori', 'milan', 'DEF'),
    ('66666666-6666-4666-8666-000000000085'::uuid, 'seed:ruben-loftus-cheek', 'milan', 'MID'),
    ('66666666-6666-4666-8666-000000000086'::uuid, 'seed:semuel-pizzignacco', 'monza', 'GK'),
    ('66666666-6666-4666-8666-000000000087'::uuid, 'seed:armando-izzo', 'monza', 'DEF'),
    ('66666666-6666-4666-8666-000000000088'::uuid, 'seed:matteo-pessina', 'monza', 'MID'),
    ('66666666-6666-4666-8666-000000000089'::uuid, 'seed:milan-djuric', 'monza', 'FWD'),
    ('66666666-6666-4666-8666-000000000090'::uuid, 'seed:alex-meret', 'napoli', 'GK'),
    ('66666666-6666-4666-8666-000000000091'::uuid, 'seed:giovanni-di-lorenzo', 'napoli', 'DEF'),
    ('66666666-6666-4666-8666-000000000092'::uuid, 'seed:romelu-lukaku', 'napoli', 'FWD'),
    ('66666666-6666-4666-8666-000000000093'::uuid, 'seed:scott-mctominay', 'napoli', 'MID'),
    ('66666666-6666-4666-8666-000000000094'::uuid, 'seed:zion-suzuki', 'parma', 'GK'),
    ('66666666-6666-4666-8666-000000000095'::uuid, 'seed:enrico-delprato', 'parma', 'DEF'),
    ('66666666-6666-4666-8666-000000000096'::uuid, 'seed:antoine-hainaut', 'parma', 'MID'),
    ('66666666-6666-4666-8666-000000000097'::uuid, 'seed:mateo-pellegrino', 'parma', 'FWD'),
    ('66666666-6666-4666-8666-000000000098'::uuid, 'seed:pontus-almqvist', 'parma', 'FWD'),
    ('66666666-6666-4666-8666-000000000099'::uuid, 'seed:lorenzo-pellegrini', 'roma', 'MID'),
    ('66666666-6666-4666-8666-000000000100'::uuid, 'seed:evan-ndicka', 'roma', 'DEF'),
    ('66666666-6666-4666-8666-000000000101'::uuid, 'seed:matias-soule', 'roma', 'FWD'),
    ('66666666-6666-4666-8666-000000000102'::uuid, 'seed:andrea-consigli', 'sassuolo', 'GK'),
    ('66666666-6666-4666-8666-000000000103'::uuid, 'seed:tarik-muharemovic', 'sassuolo', 'DEF'),
    ('66666666-6666-4666-8666-000000000104'::uuid, 'seed:kristian-thorstvedt', 'sassuolo', 'MID'),
    ('66666666-6666-4666-8666-000000000105'::uuid, 'seed:armand-lauriente', 'sassuolo', 'FWD'),
    ('66666666-6666-4666-8666-000000000106'::uuid, 'seed:samuele-mulattieri', 'sassuolo', 'FWD'),
    ('66666666-6666-4666-8666-000000000107'::uuid, 'seed:vanja-milinkovic-savic', 'torino', 'GK'),
    ('66666666-6666-4666-8666-000000000108'::uuid, 'seed:alessandro-buongiorno', 'torino', 'DEF'),
    ('66666666-6666-4666-8666-000000000109'::uuid, 'seed:nikola-vlasic', 'torino', 'MID'),
    ('66666666-6666-4666-8666-000000000110'::uuid, 'seed:duvan-zapata', 'torino', 'FWD'),
    ('66666666-6666-4666-8666-000000000111'::uuid, 'seed:maduka-okoye', 'udinese', 'GK'),
    ('66666666-6666-4666-8666-000000000112'::uuid, 'seed:jaka-bijol', 'udinese', 'DEF'),
    ('66666666-6666-4666-8666-000000000113'::uuid, 'seed:lazar-samardzic', 'udinese', 'MID'),
    ('66666666-6666-4666-8666-000000000114'::uuid, 'seed:lorenzo-lucca', 'udinese', 'FWD'),
    ('66666666-6666-4666-8666-000000000115'::uuid, 'seed:florian-thauvin', 'udinese', 'MID'),
    ('66666666-6666-4666-8666-000000000116'::uuid, 'seed:filip-stankovic', 'venezia', 'GK'),
    ('66666666-6666-4666-8666-000000000117'::uuid, 'seed:jay-idzes', 'venezia', 'DEF'),
    ('66666666-6666-4666-8666-000000000118'::uuid, 'seed:hans-nicolussi', 'venezia', 'MID'),
    ('66666666-6666-4666-8666-000000000119'::uuid, 'seed:gaetano-oristanio', 'venezia', 'MID'),
    ('66666666-6666-4666-8666-000000000120'::uuid, 'seed:joel-pohjanpalo', 'venezia', 'FWD')
) as v(registration_id, external_ref, club_code, role)
join public.players p on p.external_ref = v.external_ref and p.competition_id = c.id
join public.competitions c on c.code = 'serie_a'
join public.seasons s on s.competition_id = c.id and s.code = '2026-27'
join public.clubs cl on cl.competition_id = c.id and cl.code = v.club_code
on conflict (season_id, player_id, effective_from_gameweek) do update
set
  club_id = excluded.club_id,
  role = excluded.role,
  effective_to_gameweek = excluded.effective_to_gameweek;

-- ---------------------------------------------------------------------------
-- Controllo: se un conteggio non torna, la transazione viene annullata.
-- ---------------------------------------------------------------------------

do $check$
declare
  v_clubs int;
  v_players int;
  v_thin_clubs int;
  v_role_gaps int;
  v_squad_size int;
begin
  select count(*)
    into v_clubs
  from public.season_clubs sc
  join public.seasons s on s.id = sc.season_id
  join public.competitions c on c.id = s.competition_id
  where c.code = 'serie_a'
    and s.code = '2026-27';

  if v_clubs <> 20 then
    raise exception 'Attesi 20 club in season_clubs, trovati %', v_clubs;
  end if;

  select (r.definition ->> 'squad_size')::int
    into v_squad_size
  from public.rulesets r
  where r.code = 'fantaventi'
    and r.version = 1;

  if v_squad_size <> v_clubs then
    raise exception 'squad_size del ruleset (%) diverso dai club di stagione (%)', v_squad_size, v_clubs;
  end if;

  select count(*)
    into v_players
  from public.player_registrations pr
  join public.seasons s on s.id = pr.season_id
  join public.competitions c on c.id = s.competition_id
  join public.players p on p.id = pr.player_id
  where c.code = 'serie_a'
    and s.code = '2026-27'
    and p.external_ref like 'seed:%'
    and pr.effective_from_gameweek = 1;

  if v_players <> 120 then
    raise exception 'Attesi 120 calciatori di seed, trovati %', v_players;
  end if;

  select count(*)
    into v_thin_clubs
  from public.season_clubs sc
  join public.seasons s on s.id = sc.season_id
  join public.competitions c on c.id = s.competition_id
  where c.code = 'serie_a'
    and s.code = '2026-27'
    and (
      select count(*)
      from public.player_registrations pr
      where pr.season_id = sc.season_id
        and pr.club_id = sc.club_id
        and pr.effective_from_gameweek = 1
        and pr.effective_to_gameweek is null
    ) < 6;

  if v_thin_clubs <> 0 then
    raise exception '% club con meno di 6 calciatori nel listone di test', v_thin_clubs;
  end if;

  select count(*)
    into v_role_gaps
  from public.season_clubs sc
  join public.seasons s on s.id = sc.season_id
  join public.competitions c on c.id = s.competition_id
  cross join (values ('GK'), ('DEF'), ('MID'), ('FWD')) as roles(role)
  where c.code = 'serie_a'
    and s.code = '2026-27'
    and not exists (
      select 1
      from public.player_registrations pr
      where pr.season_id = sc.season_id
        and pr.club_id = sc.club_id
        and pr.role::text = roles.role
        and pr.effective_from_gameweek = 1
        and pr.effective_to_gameweek is null
    );

  if v_role_gaps <> 0 then
    raise exception '% coppie club/ruolo scoperte nel listone di test', v_role_gaps;
  end if;
end
$check$;

commit;
