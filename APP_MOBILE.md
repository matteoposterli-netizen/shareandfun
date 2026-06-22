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
- Android: build e test in locale sul telefono di Matteo. OK.

## Stack mobile
- Capacitor 8 (core + android + cli).
- Biometria: @capgo/capacitor-native-biometric (v8).
- Rifiniture app-like: @capacitor/splash-screen + @capacitor/status-bar.
- Push (fase 2): @capacitor-firebase/messaging (token FCM unificato).

## Fasi
- [in corso] **Fase 1** — wrapper Android (bundle locale) + login biometrico.
  Nessuna modifica DB. Branch feat/mobile-android-fase1 *(vedi nota "Branch" sotto)*.
- [da fare] **Fase 2** — push notifiche. Richiede: progetto Firebase, tabella
  `push_tokens` (user_id → token FCM), Edge Function `invia-push` agganciata agli
  stessi call site di invia-email/invia-whatsapp. Modifiche a Supabase produzione:
  conferma esplicita di Matteo prima di migration/deploy.
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

## Config Android
- `AndroidManifest.xml`: aggiunto `<uses-permission android:name="android.permission.USE_BIOMETRIC" />`.
- `minSdkVersion = 24` (default Capacitor 8; ≥ 23 richiesto da androidx.biometric).
- `compileSdk/targetSdk = 36`. App in HTTPS con Supabase (nessun cleartext).

---

## Prerequisiti build (macchina locale di Matteo)
- **Node.js ≥ 20** (testato con Node 22) + npm.
- **JDK 17** (o 21).
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

## Stato verifica in questa sessione (ambiente remoto)
Eseguito e **verificato** nel container di sviluppo:
- `npm install` (95 pacchetti, 0 vulnerabilità).
- `npx cap add android` → progetto nativo generato; 3 plugin rilevati:
  splash-screen, status-bar, **@capgo/capacitor-native-biometric**.
- `sync-web.sh` + `npm run cap:sync` → www assemblata (29 file) e copiata in
  `android/app/src/main/assets/public`.
- `web-mobile/mobile-init.js` presente in www e incluso da index.html; tutti i
  percorsi nativi guardati da `isNativePlatform`.

**NON eseguibile qui**: `./gradlew assembleDebug` (compilazione APK) richiede
l'Android SDK, il cui download (`dl.google.com`) è bloccato dalla network egress
policy del container remoto. La build APK va lanciata sulla macchina locale di
Matteo con i comandi sopra (è comunque lì che si testa, dato che il container
non raggiunge il telefono fisico).

## Modifiche file per file (Fase 1)
**Nuovi:**
- `web-mobile/mobile-init.js` — integrazione biometrica (no-op sul web).
- `mobile/package.json`, `mobile/capacitor.config.json`, `mobile/sync-web.sh`,
  `mobile/.gitignore` — progetto Capacitor.
- `mobile/android/**` — progetto nativo generato + `USE_BIOMETRIC` nel manifest.
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
Indicazione del prompt: `feat/mobile-android-fase1`. In questa sessione il lavoro
è stato sviluppato sul branch designato dall'ambiente di esecuzione remoto
(`claude/new-session-c9jh21`), che genera comunque un Preview Deployment Vercel.
Nessun merge su `main`. Se serve il nome `feat/mobile-android-fase1`, basta
rinominare/ribranchare prima del merge — il contenuto è identico.

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
