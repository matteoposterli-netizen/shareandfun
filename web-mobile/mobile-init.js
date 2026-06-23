/*
 * mobile-init.js — Integrazione biometrica per il wrapper Capacitor (Android).
 *
 * Caricato da index.html con un <script> classico (NIENTE bundler). È un
 * NO-OP completo sul web: tutti i percorsi nativi sono guardati da
 * `isNative()` (window.Capacitor?.isNativePlatform?.()), quindi il deploy
 * Vercel NON cambia comportamento — lo script si carica e non fa nulla.
 *
 * Sul device nativo aggiunge una "serratura biometrica" davanti alla sessione
 * Supabase: dopo un login riuscito (previo consenso esplicito dell'utente)
 * salva il refresh_token dietro biometria nel Keystore Android; all'avvio
 * successivo lo sblocco biometrico ripristina la sessione senza ridigitare la
 * password. NON sostituisce Supabase Auth: è solo un lucchetto locale.
 *
 * Accede al plugin via il proxy globale di Capacitor
 * (window.Capacitor.Plugins.NativeBiometric) per non richiedere un bundler.
 *
 * Dipendenze a runtime già definite quando questo file viene eseguito:
 *   - `sb`   (client Supabase, js/state.js)
 *   - `doLogin`, `doLogout`, `completeInviteRegistration` (js/auth.js)
 *   - `loadUserAndRoute`, `showView` (js/router.js)
 *   - `currentUser` (js/state.js)
 */
(function () {
  'use strict';

  // Chiave del secure store (Keychain/Keystore) e flag locale di "arruolamento".
  var SERVER = 'spiaggiamia.com';
  var ENROLL_FLAG = 'sm_bio_user'; // localStorage: contiene lo user.id arruolato

  function isNative() {
    try {
      return !!(window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }

  // Proxy al plugin nativo (undefined sul web).
  function bio() {
    try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBiometric; }
    catch (e) { return undefined; }
  }

  // Salva (o aggiorna) il refresh_token corrente dietro biometria.
  async function saveCred(session) {
    var np = bio();
    if (!np || !session || !session.refresh_token) return;
    await np.setCredentials({
      username: session.user.id,
      password: session.refresh_token,
      server: SERVER,
    });
  }

  // Cancella la credenziale salvata e disattiva l'arruolamento.
  async function clearCredentials() {
    if (!isNative()) return;
    var np = bio();
    try { if (np) await np.deleteCredentials({ server: SERVER }); }
    catch (e) { /* nessuna credenziale: ignora */ }
    try { localStorage.removeItem(ENROLL_FLAG); } catch (e) {}
  }

  // Fallback: l'utente deve autenticarsi normalmente (no auto-route da sessione
  // persistita). Mostriamo il form di login.
  function showLoginFallback() {
    try { if (typeof showView === 'function') showView('auth', 'login'); }
    catch (e) {}
  }

  // ---- AVVIO APP -----------------------------------------------------------
  // Ritorna true se la biometria "possiede" l'avvio (lo startup di main.js
  // NON deve proseguire con l'auto-route da sessione persistita).
  async function tryBiometricUnlock() {
    if (!isNative()) return false;
    var np = bio();
    if (!np) return false;

    var enrolled = null;
    try { enrolled = localStorage.getItem(ENROLL_FLAG); } catch (e) {}
    // Utente che non ha mai attivato la biometria → flusso web normale.
    if (!enrolled) return false;

    // Da qui in poi il lucchetto biometrico governa l'avvio.
    try {
      var avail = await np.isAvailable();
      if (!avail || !avail.isAvailable) {
        // Biometria non più disponibile/enrollata sul device → login normale,
        // ma senza auto-route silenzioso da una eventuale sessione persistita.
        showLoginFallback();
        return true;
      }

      await np.verifyIdentity({
        reason: 'Sblocca SpiaggiaMia',
        title: 'SpiaggiaMia',
        subtitle: 'Accedi con impronta o volto',
        description: '',
      });

      var cred = await np.getCredentials({ server: SERVER });
      if (!cred || !cred.password) { showLoginFallback(); return true; }

      var res = await sb.auth.refreshSession({ refresh_token: cred.password });
      if (res.error || !res.data || !res.data.session) {
        // Refresh token non più valido (ruotato/scaduto): pulizia + login.
        await clearCredentials();
        showLoginFallback();
        return true;
      }

      // Sessione ripristinata: aggiorna il token salvato e instrada per ruolo.
      try { await saveCred(res.data.session); } catch (e) {}
      currentUser = res.data.session.user;
      await loadUserAndRoute();
      return true;
    } catch (e) {
      // Annullamento o errore biometria → login normale (lucchetto attivo).
      console.warn('[mobile] sblocco biometrico annullato/fallito', e);
      showLoginFallback();
      return true;
    }
  }

  // ---- DOPO IL LOGIN -------------------------------------------------------
  // Propone (una sola volta) di salvare la sessione dietro biometria.
  async function afterLogin() {
    if (!isNative()) return;
    var np = bio();
    if (!np) return;
    try {
      var s = await sb.auth.getSession();
      var session = s && s.data && s.data.session;
      if (!session || !session.refresh_token) return; // login non riuscito

      var enrolled = null;
      try { enrolled = localStorage.getItem(ENROLL_FLAG); } catch (e) {}
      if (enrolled === session.user.id) {
        // Già arruolato: aggiorna silenziosamente il token salvato.
        await saveCred(session);
        return;
      }

      // Onboarding biometrico SOLO per i proprietari: gli stagionali nell'app
      // vedono solo l'overlay owner-only (owner-gate.js), niente proposta qui.
      // Fail-open solo se il gate non è caricato.
      var gate = window.SpiaggiaMiaOwnerGate;
      if (gate && typeof gate.isProprietario === 'function') {
        var isOwner = await gate.isProprietario();
        if (!isOwner) return; // non proprietario: niente proposta biometrica
      }

      var avail = await np.isAvailable();
      if (!avail || !avail.isAvailable) return; // device senza biometria

      var ok = window.confirm('Vuoi accedere più velocemente con impronta o volto la prossima volta?');
      if (!ok) return;

      await saveCred(session);
      try { localStorage.setItem(ENROLL_FLAG, session.user.id); } catch (e) {}
    } catch (e) {
      console.warn('[mobile] afterLogin error', e);
    }
  }

  // ---- AGGANCI AL FLUSSO ESISTENTE ----------------------------------------
  // Wrappa le funzioni globali (definite da auth.js) senza toccarne il codice.
  function wrapAfter(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = async function () {
      var r = await orig.apply(this, arguments);
      try { await after(); } catch (e) { console.warn('[mobile] post-hook ' + name, e); }
      return r;
    };
  }

  if (isNative()) {
    wrapAfter('doLogin', afterLogin);
    wrapAfter('completeInviteRegistration', afterLogin);

    var origLogout = window.doLogout;
    if (typeof origLogout === 'function') {
      window.doLogout = async function () {
        await clearCredentials();
        return origLogout.apply(this, arguments);
      };
    }

    // Mantiene il refresh_token salvato sempre allineato a quello corrente
    // (Supabase ruota i refresh token a ogni refresh). Solo se arruolati.
    sb.auth.onAuthStateChange(function (event, session) {
      if (!session) return;
      var enrolled = null;
      try { enrolled = localStorage.getItem(ENROLL_FLAG); } catch (e) {}
      if (enrolled && enrolled === session.user.id &&
          (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
        saveCred(session).catch(function () {});
      }
    });

    // Rifiniture app-like (status bar) se i plugin sono presenti.
    try {
      var SB = window.Capacitor.Plugins.StatusBar;
      if (SB && SB.setBackgroundColor) {
        SB.setBackgroundColor({ color: '#1B6CA8' }).catch(function () {});
      }
    } catch (e) {}
  }

  // Esposizione secondo convenzione window.*
  window.SpiaggiaMiaMobile = {
    isNative: isNative,
    tryBiometricUnlock: tryBiometricUnlock,
    afterLogin: afterLogin,
    clearCredentials: clearCredentials,
  };
})();
