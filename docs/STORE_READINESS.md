# Pacchettizzazione iOS, Android e PWA

FantaVenti resta un'app Next.js. Il guscio nativo carica il sito pubblicato (`https://fantaventi2-0.vercel.app`) perché login, API e cron non stanno in un export statico. `webDir` è `public`: contiene icone e file statici, non il bundle Next. `npx cap sync` può avvisare che manca `index.html`; è atteso. Il sito vero arriva da `server.url`.

Bundle e package id: `it.fantaventi.app` (`capacitor.config.ts`).

Le cartelle `ios/` e `android/` non sono nel repository. Si generano in locale, su una macchina con Xcode (macOS) per iOS e Android Studio per Android.

## Comandi

Dalla root del progetto, con Node e le dipendenze già installate (`npm install`):

```bash
npx cap add ios
npx cap add android
npx cap sync
```

Dopo ogni modifica a `capacitor.config.ts` o agli asset in `public/`:

```bash
npx cap sync
```

Apri i progetti nativi:

```bash
npx cap open ios
npx cap open android
```

Verifica web prima di archiviare:

```bash
npx tsc --noEmit
npm run test:engine
npm run build
```

Build store:

- iOS: Xcode, schema App, destinazione Any iOS Device, Product → Archive, poi App Store Connect.
- Android: Android Studio, Build → Generate Signed Bundle / APK, formato Android App Bundle (`.aab`).

Non committare `ios/` e `android/`: sono in `.gitignore`.

## Asset

| Uso | File |
| --- | --- |
| PWA 192 | `public/icons/icon-192.png` |
| PWA 512 | `public/icons/icon-512.png` |
| Apple touch | `public/apple-touch-icon.png` |
| Manifest | `/manifest.webmanifest` |

Se in Laboratorio → Brand & Grafica carichi le icone, il manifest usa quegli URL e, se mancano, torna ai file locali. L'icona Apple della home screen resta `public/apple-touch-icon.png` finché non la sostituisci con un PNG 180×180 o 192×192. Il colore accento del tema segue il brand; il default è `#c6f531` su fondo `#09090b`.

Il bucket `brand-assets` per le icone esiste già sul database del sito; per un database nuovo lo crea `supabase/migrations/20261126000000_partenza.sql`.

## App Store Connect

- Nome: FantaVenti. Bundle ID: `it.fantaventi.app`.
- Categoria: Sport o Giochi. Non è gambling e non è un'app di scommesse.
- Nella descrizione e nelle note per la review: gioco gratuito di fantacalcio, nessun costo di iscrizione, nessun premio in denaro, nessuna puntata. Il testo pubblico è in `/termini` e `/privacy`.
- Privacy Policy URL: `https://fantaventi2-0.vercel.app/privacy`.
- Termini: `https://fantaventi2-0.vercel.app/termini`.
- Account: la cancellazione è dentro l'app, pagina Account, pulsante «Elimina definitivamente il mio account». Non rimandare solo a una mail.
- Un presidente di lega con altri partecipanti non può cancellarsi finché non trasferisce la presidenza o scioglie la lega. La schermata lo dice.
- Login obbligatorio per giocare. Prepara un utente di prova per il revisore (email e password nel campo Notes), più il percorso Account → elimina.
- Permessi: solo quelli che la build chiede davvero. Push: notifica, non tracking. Nessun accesso a contatti, foto o posizione.
- `ITSAppUsesNonExemptEncryption`: di solito No, se non aggiungi cifratura oltre HTTPS.
- Età: 4+ o l'equivalente che Apple assegna dopo il questionario. Non dichiarare azzardo.

## Google Play Console

- Package name: `it.fantaventi.app`.
- Stesse note: gratuito, niente soldi, niente scommesse. Data safety: account (email, nome, telefono se inserito), niente dati venduti.
- Privacy: `https://fantaventi2-0.vercel.app/privacy`.
- Eliminazione account in-app, stesso pulsante. Play chiede anche un URL: indica la pagina Account dopo il login, oppure `/privacy` se il form lo accetta come spiegazione del percorso. Il requisito vero è il pulsante dentro l'app.
- Content rating: questionario IARC. Rispondi che non c'è gambling.
- Target API: quello richiesto da Play nel momento dell'invio (Android Studio propone il target del progetto Capacitor).

## Push native (APNs e FCM)

Il bridge (`lib/native/bridge.ts`) chiede il permesso, legge il token e lo manda a `POST /api/push/device`. Senza questi passi il token non arriva:

1. La tabella `device_push_tokens` esiste già sul database del sito (per un database nuovo la crea `supabase/migrations/20261126000000_partenza.sql`). Senza tabella la route risponde 409 e lo scrive in chiaro.
2. iOS: capability Push Notifications, chiave APNs in Apple Developer, caricata nel provider che userai per inviare (Firebase o invio diretto).
3. Android: progetto Firebase, `google-services.json` in `android/app`, non nel repository se contiene chiavi.
4. Le push web (VAPID) e le push native sono due canali. Le env `VAPID_*` non sostituiscono APNs/FCM.

## Ambiente che non sta nel codice

- `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` su Vercel, se vuoi gli avvisi dei cron in produzione. `TELEGRAM_CHAT_ID` accetta un id oppure più id separati da virgola. In locale possono già esserci. Non finiscono nel client.
- `CRON_SECRET` resta solo su Vercel e GitHub Actions.
- Non mettere una chiave `crons` in `vercel.json`.
