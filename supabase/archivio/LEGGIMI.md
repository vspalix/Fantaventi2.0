# Archivio dei vecchi file SQL

Questi 39 file hanno costruito il database "a toppe", eseguiti a mano nell'editor SQL di Supabase
tra il 9 e il 26 novembre 2026. Dal 26/11/2026 il database è descritto da
`../migrations/20261126000000_partenza.sql` (vedi `../README.md`).

**Non eseguire più nessuno di questi file.** Alcuni cambiano o cancellano dati, altri riscrivono
funzioni con versioni più vecchie di quelle in uso. Restano qui solo come storia e per capire
perché una tabella o una funzione è fatta in un certo modo.

Stato verificato il 26/11/2026 confrontando, in sola lettura, il database del sito con i file:

- **Applicato**: tutto ciò che il file crea esiste sul sito, uguale.
- **Mai eseguito** / **In parte**: vedi la nota.
- **Cambia dati**: modifica righe esistenti, non solo la struttura.

Le cartelle indicano dove stava il file prima dello spostamento (radice del progetto o `supabase/`).

| File | Cosa faceva | Stato sul sito |
|---|---|---|
| `schema.sql` | Struttura iniziale: tipi, tabelle principali, vincoli. | Applicato |
| `schema_sync.sql` | Allineava un database già creato alle colonne nuove. | Applicato |
| `supabase_seed.sql` | Dati iniziali: regolamento, stagione 2026-27, club, listone di prova (120 calciatori). | Applicato. **Cambia dati**: rieseguirlo sovrascriverebbe regolamento, stagione e listone |
| `rls_public.sql` | Regole RLS su tutto lo schema public e funzioni `is_super_admin`, `can_read_team`, `can_read_league`. | Applicato |
| `production_architecture.sql` | Partite reali, live score, storico trasferimenti, blocco delle giornate "final". | **In parte**: lo storico trasferimenti e il blocco delle giornate final (3 funzioni, 7 trigger) non sono attivi. Decisione rimandata (passo 4, punto D) |
| `calendar_setup.sql` | Calendario di stagione, giornate modificate a mano, sincronizzazione delle partite. | Applicato |
| `multi_competition.sql` | Più competizioni, giornate oltre la 38. | Applicato |
| `roster_validation.sql` | Controllo della rosa (`validate_fantasy_team_roster`). | Applicato |
| `lineup_and_scoring.sql` | Formazione e calcolo punteggi. | Applicato (la sua `submit_lineup` è stata poi sostituita da quella di `league_hub.sql`) |
| `league_hub.sql` | Range di giornate della lega, `submit_lineup`, classifica `league_standings`. | Applicato |
| `lineup_lock.sql` | Blocco della squadra durante il salvataggio della formazione. | Applicato |
| `league_settings.sql` | Regole della lega e stato "locked" delle partite. | Applicato |
| `league_roles.sql` | Admin delegati di una lega. | Applicato |
| `platform_access.sql` | Ruolo di piattaforma e formato di competizione. | Applicato |
| `platform_override.sql` | Controllo del super admin e checkpoint di mercato. | Applicato |
| `platform_maintenance.sql` | Interruttore di manutenzione. | Applicato |
| `platform_news.sql` | News in home. | Applicato |
| `platform_promo.sql` | Banner in home e link alle probabili formazioni. | Applicato |
| `engagement.sql` | Bacheca, badge, notifiche push, classifica live. | Applicato |
| `app_announcements.sql` | Annunci e avvisi nella campanella. | Applicato |
| `admin_audit.sql` | Registro delle azioni degli admin. | Applicato |
| `account_controls.sql` | Obbligo di cambio password al prossimo accesso. | Applicato |
| `profile_identity.sql` | Nome, cognome, email e telefono nel profilo. | Applicato |
| `regulation.sql` | Regolamento scritto di ogni lega. | Applicato |
| `player_availability.sql` | Indisponibili e fonte delle informazioni. | Applicato |
| `club_badges.sql` | Colori e logo dei club. | Applicato |
| `kickoff_refresh.sql` | Orario della partita fissato a mano. | Applicato |
| `match_hold.sql` | Partita sospesa o rinviata (voti in attesa). | Applicato |
| `match_postponed.sql` | Partita rinviata. | Applicato |
| `role_correction.sql` | Ruolo di un calciatore corretto a mano e bloccato. | Applicato |
| `sandbox_league.sql` | Lega di prova isolata dal gioco vero. | Applicato |
| `drop_super.sql` | Toglieva la vecchia regola SUPER e la colonna `is_super`. | **Mai eseguito**: `player_registrations.is_super` esiste ancora, non usata dal controllo rosa. **Cambia dati** (regolamento) |
| `ops_telemetry.sql` | Tabella `ops_latency` per i tempi di risposta del laboratorio. | **Mai eseguito**: il codice se ne accorge e smette di scrivere (passo 4, punto C) |
| `supabase/system_settings.sql` | Impostazioni del laboratorio e storico delle sincronizzazioni. | Applicato |
| `supabase/security_hardening.sql` | RLS e permessi chiusi sulle tabelle create dopo `rls_public.sql`. | Applicato |
| `supabase/device_push_tokens.sql` | Token per le notifiche dell'app Android e iPhone. | Applicato |
| `supabase/brand_storage.sql` | Bucket `brand-assets` per logo e icone, colonne del brand. | Applicato |
| `supabase/league_teams.sql` | Una squadra per lega, non una per stagione. | Applicato |
| `supabase/vote_schedule.sql` | Letture dei voti a orari fissi (`vote_reads`, `vote_clock`). | Applicato (eseguito e verificato il 26/11/2026) |

Altre differenze trovate e già riportate nel file di partenza:

- `competitions.start_matchday` ed `end_matchday` esistono sul sito ma nessun file le crea (aggiunte a mano).
- I tipi, alcune regole RLS e alcuni permessi nascono da blocchi `DO ... EXECUTE` dentro i file, non da istruzioni dirette.

Il confronto completo e il backup del 26/11/2026 sono fuori dal repository (contengono dati personali).
