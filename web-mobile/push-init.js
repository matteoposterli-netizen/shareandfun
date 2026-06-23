/*
 * push-init.js — Registrazione del token FCM per il wrapper Capacitor (Android).
 *
 * Caricato da index.html con un <script> classico (NIENTE bundler). È un
 * NO-OP completo sul web: tutti i percorsi nativi sono guardati da
 * `isNative()` (window.Capacitor?.isNativePlatform?.()), quindi il deploy
 * Vercel NON cambia comportamento — lo script si carica e non fa nulla.
 *
 * Sul device nativo, dopo un login riuscito, chiede il permesso notifiche
 * (Android 13+ → POST_NOTIFICATIONS a runtime), ottiene il token FCM e lo
 * registra in Supabase via RPC `register_push_token`. Su logout cancella il
 * proprio token (mentre la sessione è ancora valida). Un listener sulla
 * rotazione del token lo ri-registra automaticamente.
 *
 * Questa è la metà "client" della Fase 2 (registrazione token). L'invio vero
 * (Edge Function invia-push) e l'aggancio ai call site sono la Fase 2b.
 * WhatsApp resta un canale parallelo invariato.
 *
 * Accede al plugin via il proxy globale di Capacitor
 * (window.Capacitor.Plugins.FirebaseMessaging) per non richiedere un bundler.
 *
 * Dipendenze a runtime già definite quando questo file viene eseguito:
 *   - `sb` (client Supabase, js/state.js) — autenticato come l'utente loggato
 *   - `doLogin`, `doLogout`, `completeInviteRegistration` (js/auth.js)
 *
 * Se la tabella `push_tokens` / la RPC `register_push_token` non esistono ancora
 * sul DB, la registrazione fallisce in modo graceful (catch + console.warn)
 * senza rompere il login.
 */
(function () {
  'use strict';

  var PLATFORM = 'android';
  var TOKEN_KEY = 'sm_push_token'; // localStorage: ultimo token registrato
  var lastToken = null;            // copia in-memory per l'unregister al logout

  function isNative() {
    try {
      return !!(window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }

  // Proxy al plugin nativo (undefined sul web).
  function fcm() {
    try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseMessaging; }
    catch (e) { return undefined; }
  }

  function rememberToken(token) {
    lastToken = token;
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
  }

  function forgetToken() {
    lastToken = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // Android 13+ richiede POST_NOTIFICATIONS a runtime. Ritorna true se concesso.
  async function ensurePermission() {
    var p = fcm();
    if (!p) return false;
    try {
      var cur = await p.checkPermissions();
      if (cur && cur.receive === 'granted') return true;
      var req = await p.requestPermissions();
      return !!(req && req.receive === 'granted');
    } catch (e) {
      console.warn('[push] richiesta permesso fallita', e);
      return false;
    }
  }

  // Scrive (upsert) il token corrente nella tabella via RPC SECURITY DEFINER.
  async function persistToken(token) {
    if (!token) return;
    try {
      var r = await sb.rpc('register_push_token', { p_token: token, p_platform: PLATFORM });
      if (r && r.error) { console.warn('[push] register_push_token error', r.error); return; }
      rememberToken(token);
    } catch (e) {
      console.warn('[push] register_push_token fallita', e);
    }
  }

  // ---- DOPO IL LOGIN -------------------------------------------------------
  // Permesso → token FCM → registrazione su Supabase.
  async function register() {
    if (!isNative()) return;
    var p = fcm();
    if (!p) return;
    try {
      // Push SOLO per i proprietari (destinatari delle notifiche gestore): gli
      // stagionali nell'app vedono solo l'overlay owner-only (owner-gate.js).
      // Niente richiesta permesso né token per loro. Fail-open se gate assente.
      var gate = window.SpiaggiaMiaOwnerGate;
      if (gate && typeof gate.isProprietario === 'function') {
        var isOwner = await gate.isProprietario();
        if (!isOwner) return; // non proprietario: niente permesso né token
      }

      var granted = await ensurePermission();
      if (!granted) { console.warn('[push] permesso notifiche negato — nessun token'); return; }
      var res = await p.getToken();
      var token = res && res.token;
      if (!token) { console.warn('[push] getToken vuoto'); return; }
      await persistToken(token);
    } catch (e) {
      console.warn('[push] register fallita', e);
    }
  }

  // ---- SU LOGOUT -----------------------------------------------------------
  // Elimina il proprio token mentre si è ancora autenticati (RLS delete_own).
  async function unregister() {
    if (!isNative()) return;
    var token = lastToken;
    if (!token) { try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {} }
    if (!token) return;
    try {
      var r = await sb.from('push_tokens').delete().eq('token', token);
      if (r && r.error) console.warn('[push] delete token error', r.error);
    } catch (e) {
      console.warn('[push] unregister fallita', e);
    }
    forgetToken();
  }

  // ---- AGGANCI AL FLUSSO ESISTENTE ----------------------------------------
  // Wrappa le funzioni globali (definite da auth.js) senza toccarne il codice.
  function wrapAfter(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = async function () {
      var r = await orig.apply(this, arguments);
      try { await after(); } catch (e) { console.warn('[push] post-hook ' + name, e); }
      return r;
    };
  }

  if (isNative()) {
    // Registrazione dopo login / completamento invito.
    wrapAfter('doLogin', register);
    wrapAfter('completeInviteRegistration', register);

    // Logout: cancella il token PRIMA del sign-out (sessione ancora valida).
    // push-init.js è incluso dopo mobile-init.js, quindi qui window.doLogout è
    // già il wrapper biometrico: il nostro unregister gira per primo.
    var origLogout = window.doLogout;
    if (typeof origLogout === 'function') {
      window.doLogout = async function () {
        try { await unregister(); } catch (e) { console.warn('[push] pre-logout', e); }
        return origLogout.apply(this, arguments);
      };
    }

    var p = fcm();
    if (p && typeof p.addListener === 'function') {
      // Rotazione del token FCM → ri-registra con la stessa RPC.
      try {
        p.addListener('tokenReceived', function (event) {
          var token = event && event.token;
          if (token) persistToken(token);
        });
      } catch (e) { console.warn('[push] addListener tokenReceived', e); }

      // Messaggi in foreground: gestione minimale (v1, nessuna UI in-app).
      // Le notifiche in background le mostra l'OS dal blocco `notification`.
      try {
        p.addListener('notificationReceived', function (event) {
          console.log('[push] notifica ricevuta in foreground', event);
        });
      } catch (e) { console.warn('[push] addListener notificationReceived', e); }
    }
  }

  // Esposizione secondo convenzione window.*
  window.SpiaggiaMiaPush = {
    isNative: isNative,
    register: register,
    unregister: unregister,
  };
})();
