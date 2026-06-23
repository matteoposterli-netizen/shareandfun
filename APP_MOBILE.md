# App mobile SpiaggiaMia

Stato e roadmap del wrapping della SPA in app native Android/iOS.

## Decisioni bloccate
- **App unica** che instrada per ruolo (proprietario/stagionale) riusando
  loadUserAndRoute della SPA. Nessuna logica di routing nuova.
- **Capacitor** come wrapper. **Bundle locale** degli asset (Opzione A):
  Capacitor gestisce nativamente i plugin senza toccare la SPA web (no build step).
- Progetto in **/mobile** nel repo shareandfun. Deploy web Vercel invariato
  (/mobile in .vercelignore).
- **Android prima** (build senza Mac, testabile sul telefono di Matteo, Play Store
  permissivo). iOS in fase successiva via build cloud (Matteo non ha Mac né iPhone).
- Login biometrico = serratura davanti alla sessione Supabase salvata in
  Keychain/Keystore; non sostituisce Supabase Auth.

## Hardware / vincoli
- Niente Mac → build iOS futura su cloud CI (es. Capawesome Cloud / Codemagic).
- Niente iPhone → test iOS futuri richiederanno un device Apple (iPhone usato o
  device cloud; la biometria non è testabile su device remoto).
- Android: build via CI (GitHub Actions) + test sul telefono di Matteo. Flusso
  interamente da mobile, senza PC. OK.

## Stack mobile
- Capacitor 8 (core + android + cli).
- Biometria: @capgo/capacitor-native-biometric (v8).
- Rifiniture app-like: @capacitor/splash-screen + @capacitor/status-bar.
- Push (fase 2): @capacitor-firebase/messaging (token FCM unificato).

## Fasi
- [✓ COMPLETATA] **Fase 1** — wrapper Android (bundle locale) + login biometrico.
  Nessuna modifica DB. Merge su `main` il 2026-06-22 (squash, PR #138, commit f10112c).
  **Testata su device reale**: login → consenso biometria → chiusura → riapertura →
  sblocco con impronta/volto → routing per ruolo. OK.
- [in corso] **Fase 2a** — push: registrazione del token FCM lato app. Plugin
  `@capacitor-firebase/messaging`, modulo `web-mobile/push-init.js` (no-op sul web),
  permesso `POST_NOTIFICATIONS`, tabella `push_tokens` + RPC `register_push_token`
  (migration tracciata, **non** applicata in prod). Scope concordato: push solo per
  `variazione_credito`, destinatari stagionali. WhatsApp resta un canale parallelo
  invariato. Vedi sezione "Push (Fase 2a)" più sotto.
- [✓ client] **Fase 2b** — push disponibilità stagionale → proprietario.
  Edge Function `invia-push` già deployata in produzione (FCM v1, verify_jwt=false,
  3 secret FCM). Aggancio lato client: helper `inviaPush(params)` in `js/utils.js`
  (stesso pattern session di `inviaWhatsapp`, fire-and-forget) + chiamata in
  `js/stagionale.js → salvaModifichePending` (dopo il for di salvataggio, prima del
  reset di `pendingDispChanges`). Payload: `{ stabilimento_id, cliente_id,
  ombrellone_id, giorni_aggiunti[], giorni_rimossi[] }`. La function risolve
  proprietario → `push_tokens`, formatta i giorni in range compatti e invia (skip
  graceful se nessun token). **Destinatario = proprietario** dello stabilimento.
  WhatsApp/email invariati (canale parallelo). Cache-bust `?v=20260623` su utils.js
  e stagionale.js.
- [da fare] **Fase 3** — pubblicazione Play Store + rifiniture app-like.
- [futuro] **iOS** — stesso progetto Capacitor, piattaforma ios, build cloud,
  APNs (.p8) su Firebase, account Apple Developer, device di test. Per la review
  4.2 di Apple servono push + UI nativa (tab bar) come differenziatori.

---

## Struttura del progetto mobile

```
/mobile
  package.json            # deps Capacitor + plugin, script npm
  capacitor.config.json   # appId com.spiaggiamia.app, appName SpiaggiaMia, webDir www
  sync-web.sh             # assembla mobile/www dalla root del repo (idempotente)
  .gitignore              # ignora node_modules/, www/, artefatti build android
  www/                    # GENERATA da sync-web.sh (NON versionata)
  android/                # progetto nativo (generato da `npx cap add android`, versionato)
/web-mobile
  mobile-init.js          # integrazione biometrica (no-op sul web)
  push-init.js            # registrazione token FCM (no-op sul web)
  owner-gate.js           # gate "app riservata ai gestori" (no-op sul web)
/.github/workflows
  android-debug.yml       # CI: build APK debug + artefatto (vedi sezione CI)
```

### Perché `web-mobile/` sta nella ROOT (non in /mobile)
`index.html` è un file unico condiviso da web (Vercel) e app (bundle). Include
`<script src="web-mobile/mobile-init.js?v=...">`. Perché quel tag sia **innocuo
ma caricabile** anche sul web (e non un 404 in console), il file deve essere
raggiungibile dal deploy Vercel → quindi vive in `/web-mobile/` nella root.
`sync-web.sh` lo copia dentro `mobile/www/web-mobile/` per il bundle nativo.
È un NO-OP sul web grazie alla guardia `isNativePlatform()`.

## Integrazione biometrica (web-mobile/mobile-init.js)
Script classico (niente bundler) che accede al plugin via il proxy globale
`window.Capacitor.Plugins.NativeBiometric`. Tutto è guardato da `isNative()`:
sul web non esegue nulla.

- **Dopo il login** (hook su `doLogin` e `completeInviteRegistration`, wrappati
  esternamente senza toccare js/auth.js): legge `sb.auth.getSession()` e, **previo
  un consenso esplicito** (`confirm` "Vuoi accedere con impronta/volto?"), salva
  il `refresh_token` dietro biometria (`setCredentials`, server `spiaggiamia.com`,
  username = user.id). Salva SOLO se l'utente accetta. La proposta compare una
  sola volta (flag `localStorage.sm_bio_user`).
- **All'avvio** (hook in js/main.js, `window.SpiaggiaMiaMobile.tryBiometricUnlock`):
  se esiste una credenziale arruolata → `isAvailable` → `verifyIdentity` →
  `getCredentials` → `sb.auth.refreshSession({ refresh_token })` →
  `loadUserAndRoute` instrada per ruolo. Se la biometria è annullata/non
  disponibile o il refresh token è scaduto → fallback al form di login (senza
  auto-route silenzioso da sessione persistita).
- **Token rotation**: Supabase ruota i refresh token. Un listener
  `onAuthStateChange` (TOKEN_REFRESHED/SIGNED_IN) ri-salva silenziosamente il
  token aggiornato nel Keystore, così la copia sicura resta sempre valida.
- **Logout** (hook su `doLogout`): cancella la credenziale salvata
  (`deleteCredentials`) + il flag, così un utente sloggato non viene
  ri-autenticato in automatico.
- API esposta: `window.SpiaggiaMiaMobile = { isNative, tryBiometricUnlock,
  afterLogin, clearCredentials }`.

## Push (Fase 2a) — registrazione token FCM (web-mobile/push-init.js)
Script classico (niente bundler) che accede al plugin via il proxy globale
`window.Capacitor.Plugins.FirebaseMessaging`. Tutto è guardato da `isNative()`:
sul web non esegue nulla. Incluso da `index.html` con
`<script src="web-mobile/push-init.js?v=...">` **dopo** `mobile-init.js`.

- **Dopo il login** (hook su `doLogin` e `completeInviteRegistration`, wrappati
  esternamente senza toccare js/auth.js): `requestPermissions()` (Android 13+ →
  `POST_NOTIFICATIONS` a runtime) → se concesso `getToken()` → registrazione via
  `sb.rpc('register_push_token', { p_token, p_platform: 'android' })`. Permesso
  negato ⇒ stop, nessun token.
- **Rotazione token**: listener `tokenReceived` → ri-registra con la stessa RPC.
- **Logout** (hook su `doLogout`, **prima** del sign-out mentre si è ancora
  autenticati — push-init è incluso dopo mobile-init quindi il suo unregister
  gira prima del clear biometrico): `sb.from('push_tokens').delete().eq('token', token)`
  (consentito da `push_tokens_delete_own`).
- **Foreground**: listener `notificationReceived` → `console.log` (v1, nessuna UI
  in-app). Le notifiche in background le mostra l'OS dal blocco `notification`.
- API esposta: `window.SpiaggiaMiaPush = { isNative, register, unregister }`.
- **Graceful degrade**: se la tabella/RPC non esistono ancora (migration non
  applicata) o se Firebase non è inizializzato (manca `google-services.json`), la
  registrazione fallisce in `catch` + `console.warn` senza rompere il login.

### DB (migration tracciata, NON applicata)
`supabase/migrations/20260622000000_create_push_tokens.sql`: tabella
`public.push_tokens` (`user_id`, `token` unique, `platform`, `enabled`,
timestamps), RLS `push_tokens_select_own` / `push_tokens_delete_own`, RPC
SECURITY DEFINER `register_push_token(p_token, p_platform)` (upsert sul token,
riassegna il device all'utente corrente). **Da applicare a mano da Matteo** su
produzione (ambiente unico live).

### A carico di Matteo (Firebase) — bloccante per il funzionamento reale
Claude Code **non** ha accesso al Firebase MCP / `firebase login` in questa
sessione, quindi `google-services.json` **non** è ancora nel repo. Per attivare
le push:
1. Firebase MCP / console: crea (o seleziona) il progetto SpiaggiaMia, registra
   un'app **Android** con package `com.spiaggiamia.app`.
2. Scarica `google-services.json` in `mobile/android/app/google-services.json` e
   **committalo** (è config client, non un segreto). Il plugin google-services in
   `mobile/android/app/build.gradle` si attiva da solo se il file è presente
   (try/catch già pronto).
3. La service-account key (per `invia-push`, Fase 2b) **NON** va committata: i
   valori `project_id` / `client_email` / `private_key` vanno salvati come secret
   Supabase in Fase 2b.

Senza `google-services.json` la CI compila comunque (il plugin google-services
non viene applicato → build verde), ma `getToken()` fallisce a runtime: nessuna
riga in `push_tokens`.

## Gate "app riservata ai gestori" (web-mobile/owner-gate.js)
Script classico (niente bundler), **NO-OP completo sul web** (guardato da
`isNative()`): sul sito spiaggiamia.com gli stagionali continuano a usare la SPA
normalmente, nessun overlay. Incluso da `index.html` con
`<script src="web-mobile/owner-gate.js?v=...">` **dopo** `push-init.js`.

Obiettivo: nell'**app** (Capacitor) l'accesso è riservato ai proprietari. Se
l'utente loggato non ha ruolo `proprietario`, viene mostrato un overlay
full-screen "🔒 App riservata ai gestori" (z-index massimo, copre la vista
stagionale rendendola inutilizzabile) con un solo pulsante "Esci"
(`window.doLogout`).

- **Determinazione ruolo** (`resolveRole`): riusa il global `currentProfile.ruolo`
  già calcolato dal router (js/router.js → `loadUserAndRoute`); se non disponibile
  fa una query diretta `sb.from('profiles').select('ruolo').eq('id', user.id)`
  (PK `id` = auth.users.id, `ruolo` ∈ {'proprietario','stagionale'}).
- **`enforceOwnerOnly()`**: non autenticato → rimuove l'overlay (no gate);
  `proprietario` → rimuove l'overlay (no-op); altrimenti → mostra l'overlay.
  Idempotente (controlla se l'overlay esiste già).
- **Aggancio**: wrappa `window.loadUserAndRoute` — il punto in cui TUTTI i flussi
  di auth (login, completamento invito, ripristino biometrico) confluiscono — e
  chiama `enforceOwnerOnly()` dopo l'esecuzione originale. Come fallback wrappa
  anche `doLogin` e `completeInviteRegistration` (che internamente chiamano
  comunque loadUserAndRoute → enforceOwnerOnly è idempotente). Stesso pattern di
  mobile-init.js / push-init.js (`typeof orig === 'function'` prima di wrappare).
- **`isProprietario()`**: check di ruolo riusabile (riusa `resolveRole`), ritorna
  `true` solo se ruolo === `proprietario`, `false` per qualsiasi altro ruolo o
  ruolo non determinabile (**fail-closed**). Usato per gateare l'onboarding nativo.
- API esposta: `window.SpiaggiaMiaOwnerGate = { isNative, enforceOwnerOnly, isProprietario }`.
- Nessuna modifica a js/auth.js / js/router.js: gli agganci sono a runtime e solo
  sul nativo. `sync-web.sh` copia l'intera `web-mobile/` → il file finisce nel
  bundle automaticamente.

### Onboarding nativo gateato al ruolo (fix 23 giu 2026)
Il prompt biometrico (`mobile-init.js → afterLogin`, la `confirm` di arruolamento)
e la registrazione del token push (`push-init.js → register`, permesso +
`getToken` + `register_push_token`) avvengono **SOLO per i proprietari**: prima
della proposta/registrazione entrambi chiamano `await window.SpiaggiaMiaOwnerGate
.isProprietario()` e si fermano (`return`) se non è proprietario. Così uno
stagionale, nell'app, vede **solo** l'overlay owner-only — nessun prompt biometrico
né richiesta notifiche. **Fail-open** solo se il gate non è caricato (modulo
assente). Lo sblocco biometrico all'avvio (`tryBiometricUnlock`) resta invariato:
un non-proprietario non ha mai una credenziale salvata. Cache-bust `?v=20260623b`
su mobile-init.js / push-init.js / owner-gate.js.

## Config Android
- `AndroidManifest.xml`: aggiunto `<uses-permission android:name="android.permission.USE_BIOMETRIC" />`
  e `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` (push).
- `minSdkVersion = 24` (default Capacitor 8; ≥ 23 richiesto da androidx.biometric).
- `compileSdk/targetSdk = 36`. App in HTTPS con Supabase (nessun cleartext).

---

## CI — build APK da mobile (senza PC)
Workflow `.github/workflows/android-debug.yml`: su `ubuntu-latest` (JDK 21, Node 22,
Android SDK 36) esegue `npm install` + `cap:sync` + `gradlew assembleDebug` e pubblica
`app-debug.apk` come artefatto. **Flusso testato e funzionante**:
1. Tab **Actions** → run "Android debug APK" → attendi il ✓ (prima volta ~6-10 min).
2. Apri il run → sezione **Artifacts** → scarica `spiaggiamia-debug-apk` (.zip) dal
   browser (l'app GitHub spesso non mostra il download artefatti).
3. Estrai l'APK, abilita "installa da origine sconosciuta", installa, testa.

Trigger attuale: push su `claude/new-session-c9jh21` + `claude/new-session-etk9fz`
(branch di Fase 2a) + `workflow_dispatch`. Dopo il merge i branch `claude/*` non
esistono più: la build su main si lancia a mano (workflow_dispatch) o si riaggancia
il trigger al branch successivo.

## Prerequisiti build (alternativa locale, se si usa un PC)
- **Node.js ≥ 20** (testato con Node 22) + npm.
- **JDK 21** (il progetto compila a Java 21; anche la CI usa JDK 21).
- **Android Studio** + **Android SDK** (Platform 36, Build-Tools 36, Platform-Tools).
  Variabile `ANDROID_HOME` (o `local.properties` con `sdk.dir=...`) configurata.
- Un telefono Android con **debug USB** attivo, oppure un emulatore.

## Comandi build (debug, da `/mobile`)
```bash
cd mobile
npm install                 # dipendenze Capacitor + plugin
npm run sync:web            # assembla www/ dalla root (idempotente)
npx cap add android         # SOLO la prima volta / dopo un clone pulito (rigenera android/)
npm run cap:sync            # sync:web + npx cap sync android (allinea www e plugin)

# Build + install su telefono FISICO collegato (USB debug):
npm run android:run         # = cap:sync && npx cap run android
#   (in alternativa, apri /mobile/android in Android Studio e premi Run)

# Solo APK debug, senza device:
npm run android:build       # = cap:sync && cd android && ./gradlew assembleDebug
# APK in: mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

## Modifiche file per file (Fase 1)
**Nuovi:**
- `web-mobile/mobile-init.js` — integrazione biometrica (no-op sul web).
- `mobile/package.json`, `mobile/capacitor.config.json`, `mobile/sync-web.sh`,
  `mobile/.gitignore` — progetto Capacitor.
- `mobile/android/**` — progetto nativo generato + `USE_BIOMETRIC` nel manifest.
- `.github/workflows/android-debug.yml` — CI build APK debug.
- `.vercelignore` (root) — esclude `mobile/` dal deploy Vercel.
- `APP_MOBILE.md` (questo file).

**Modificati (chirurgici, guardati da isNativePlatform):**
- `index.html` — un `<script src="web-mobile/mobile-init.js?v=20260622">` dopo
  `js/main.js`. Innocuo sul web.
- `js/main.js` — nel DOMContentLoaded, prima di `getSession()`, un blocco
  guardato `window.SpiaggiaMiaMobile?.tryBiometricUnlock()` che, sul nativo,
  delega l'avvio alla biometria. Sul web la condizione è falsa → nessun effetto.

`js/auth.js` e `js/router.js` **non** sono stati modificati: gli agganci
(`doLogin`/`doLogout`/`completeInviteRegistration`) sono wrappati a runtime da
mobile-init.js solo sul nativo.

## Branch
Sviluppata sul branch `claude/new-session-c9jh21` (designato dall'ambiente remoto).
**Mergiata su `main` via squash il 2026-06-22 (PR #138, commit f10112c)** — col
squash il nome del branch non incide sulla history.

## Limitazioni note (aperte)
- **Deep link email** (recovery `/?reset=1`, invito `/?invito=token`) aprono il
  browser di sistema, non l'app → rimandato a fase successiva (App Links +
  intent-filter).
- **CORS Edge Functions** vs origin app (`https://localhost` / `capacitor://localhost`)
  per invii email/WhatsApp in-app → da verificare in test e sistemare nella fase
  successiva (whitelist origin nelle function `invia-email`/`invia-whatsapp`).
- **Lucchetto vs sessione persistita**: se l'utente annulla la biometria, la
  sessione Supabase persistita resta sul device ma la UI mostra il login (nessun
  auto-route). Un hard-gate completo (disabilitare `persistSession` sul nativo)
  è una rifinitura Fase 1.x, non necessaria ora.

## Setup a carico di Matteo
- Account Google Play Developer (25$ una tantum) — solo per pubblicare, non per i test.
- Progetto Firebase — quando si parte con la Fase 2.
