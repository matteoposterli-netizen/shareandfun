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

## Config Android
- `AndroidManifest.xml`: aggiunto `<uses-permission android:name="android.permission.USE_BIOMETRIC" />`.
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

Trigger attuale: push su `claude/new-session-c9jh21` + `workflow_dispatch`. Dopo il
merge quel branch non esiste più: la build su main si lancia a mano (workflow_dispatch)
o si riaggancia il trigger al branch di Fase 2.

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
