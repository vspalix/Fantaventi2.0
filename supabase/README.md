# Database FantaVenti (Supabase)

Questa cartella descrive il database. Dal 26/11/2026 (passo 4) funziona così.

## Cartelle

| Cartella | Cosa contiene |
|---|---|
| `migrations/` | I file che costruiscono il database, **in ordine di nome** (data e ora). |
| `archivio/` | I 39 vecchi file SQL, conservati solo come storia. **Non vanno più eseguiti.** Vedi `archivio/LEGGIMI.md`. |
| `functions/` | Le funzioni Edge di Supabase (`process-gameweek`, `sync-fixtures`). |

## Il file di partenza

`migrations/20261126000000_partenza.sql` è la fotografia del database del sito al 26/11/2026:
struttura, permessi (regole RLS e GRANT), bucket `brand-assets` e i dati iniziali indispensabili
(regolamento, competizione, stagione, 20 club, impostazioni, testi delle notifiche).
Non contiene utenti, squadre, leghe, voti, calciatori, giornate o segreti.

- Serve **solo per un progetto Supabase nuovo e vuoto** (per esempio una copia di prova).
- Se trova già le tabelle, si ferma con un messaggio e non cambia niente.
- È un'unica transazione: o va tutto a buon fine, o non resta niente.
- Dopo averlo eseguito, dal pannello admin si caricano calendario, listone e indisponibili.
  Le giornate si possono creare con `select public.generate_season_calendar(<id stagione>, <prima data>, 38);`.

Il database del sito è già allineato a questo file: **non va eseguito lì**.

## Modifiche future

Ogni nuova modifica al database:

1. va in un **nuovo file** in `migrations/`, con nome `AAAAMMGGHHMMSS_descrizione.sql`
   (per esempio `20261201090000_tabella_ops_latency.sql`), mai modificando un file già eseguito;
2. si esegue **a mano** nell'editor SQL di Supabase, dopo un backup e con la conferma dell'utente;
3. va annotata in `CLAUDE.md` con la data in cui è stata eseguita sul sito.

I nomi seguono la convenzione della CLI di Supabase, così in futuro si potrà usare anche quella.
