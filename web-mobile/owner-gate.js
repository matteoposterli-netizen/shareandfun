/*
 * owner-gate.js — Gate "app riservata ai gestori" per il wrapper Capacitor (Android).
 *
 * Caricato da index.html con un <script> classico (NIENTE bundler). È un
 * NO-OP completo sul web: tutti i percorsi sono guardati da `isNative()`
 * (window.Capacitor?.isNativePlatform?.()), quindi il deploy Vercel NON cambia
 * comportamento — sul sito gli stagionali continuano a usare la SPA normalmente.
 *
 * Sul device nativo: dopo ogni flusso di autenticazione (login, completamento
 * invito, ripristino biometrico) verifica il ruolo dell'utente loggato. Se NON
 * è `proprietario`, mostra un overlay full-screen "App riservata ai gestori"
 * con un pulsante "Esci" (window.doLogout). L'overlay copre la UI sottostante
 * così la vista stagionale non è utilizzabile dall'app.
 *
 * Aggancio: wrappa `window.loadUserAndRoute` (js/router.js), il punto in cui
 * TUTTI i flussi di auth confluiscono; dopo l'esecuzione originale chiama
 * `enforceOwnerOnly()`. Come fallback wrappa anche `doLogin` e
 * `completeInviteRegistration` (js/auth.js), che internamente chiamano comunque
 * loadUserAndRoute → enforceOwnerOnly è idempotente.
 *
 * Determinazione del ruolo: preferisce il global `currentProfile.ruolo` già
 * calcolato dal router (js/state.js → `let currentProfile`, popolato da
 * loadUserAndRoute). Se non disponibile, esegue una query diretta su `profiles`
 * (colonna `ruolo` ∈ {'proprietario','stagionale'}, PK `id` = auth.users.id).
 *
 * Dipendenze a runtime già definite quando questo file viene eseguito:
 *   - `sb` (client Supabase, js/state.js)
 *   - `currentUser`, `currentProfile` (js/state.js, bare global lexical)
 *   - `loadUserAndRoute` (js/router.js), `doLogin`, `doLogout`,
 *     `completeInviteRegistration` (js/auth.js)
 */
(function () {
  'use strict';

  var OVERLAY_ID = 'sm-owner-gate-overlay';

  function isNative() {
    try {
      return !!(window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }

  function removeOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showOverlay() {
    if (document.getElementById(OVERLAY_ID)) return; // già mostrato
    var ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:#1B6CA8', 'color:#fff',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'text-align:center', 'padding:32px',
      'font-family:"DM Sans",system-ui,sans-serif'
    ].join(';');

    var icon = document.createElement('div');
    icon.textContent = '🔒';
    icon.style.cssText = 'font-size:56px;margin-bottom:20px';

    var title = document.createElement('div');
    title.textContent = 'App riservata ai gestori';
    title.style.cssText = 'font-size:24px;font-weight:700;margin-bottom:14px';

    var msg = document.createElement('div');
    msg.textContent = 'Come cliente continua a usare il sito o WhatsApp.';
    msg.style.cssText = 'font-size:16px;line-height:1.5;max-width:340px;opacity:.92;margin-bottom:32px';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Esci';
    btn.style.cssText = [
      'background:#E07B54', 'color:#fff', 'border:none',
      'border-radius:10px', 'padding:14px 36px',
      'font-size:16px', 'font-weight:700', 'cursor:pointer'
    ].join(';');
    btn.addEventListener('click', function () {
      removeOverlay();
      try {
        if (typeof window.doLogout === 'function') window.doLogout();
      } catch (e) { console.warn('[owner-gate] doLogout', e); }
    });

    ov.appendChild(icon);
    ov.appendChild(title);
    ov.appendChild(msg);
    ov.appendChild(btn);
    (document.body || document.documentElement).appendChild(ov);
  }

  // Ritorna il ruolo dell'utente loggato, oppure null se non autenticato.
  async function resolveRole() {
    // 1) Riusa ciò che il router ha già calcolato (js/state.js global).
    try {
      if (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.ruolo) {
        return currentProfile.ruolo;
      }
    } catch (e) { /* currentProfile non in scope: continua */ }

    // 2) Query diretta a profiles per l'utente della sessione corrente.
    try {
      var s = await sb.auth.getSession();
      var user = s && s.data && s.data.session && s.data.session.user;
      if (!user) return null;
      var r = await sb.from('profiles').select('ruolo').eq('id', user.id).single();
      if (r && r.error) { console.warn('[owner-gate] profiles select error', r.error); return null; }
      return r && r.data ? r.data.ruolo : null;
    } catch (e) {
      console.warn('[owner-gate] resolveRole fallita', e);
      return null;
    }
  }

  // Check di ruolo riusabile: true SOLO se l'utente loggato è `proprietario`.
  // false per qualsiasi altro ruolo o ruolo non determinabile (fail-closed).
  // Usato da mobile-init.js / push-init.js per gateare l'onboarding nativo
  // (proposta biometrica + registrazione token push) ai soli proprietari.
  async function isProprietario() {
    var role = await resolveRole();
    return role === 'proprietario';
  }

  // Applica il gate: overlay se l'utente loggato non è proprietario.
  async function enforceOwnerOnly() {
    if (!isNative()) { removeOverlay(); return; }
    var role = await resolveRole();
    if (!role) { removeOverlay(); return; }            // non autenticato → no gate
    if (role === 'proprietario') { removeOverlay(); return; } // proprietario → no-op
    showOverlay();                                      // stagionale/altro → blocco
  }

  // ---- AGGANCI AL FLUSSO ESISTENTE ----------------------------------------
  // Wrappa una funzione globale: dopo l'originale, esegue `after`.
  function wrapAfter(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = async function () {
      var r = await orig.apply(this, arguments);
      try { await after(); } catch (e) { console.warn('[owner-gate] post-hook ' + name, e); }
      return r;
    };
  }

  if (isNative()) {
    // Punto di confluenza di tutti i flussi di auth.
    wrapAfter('loadUserAndRoute', enforceOwnerOnly);
    // Fallback (idempotente): questi chiamano comunque loadUserAndRoute.
    wrapAfter('doLogin', enforceOwnerOnly);
    wrapAfter('completeInviteRegistration', enforceOwnerOnly);
  }

  // Esposizione secondo convenzione window.*
  window.SpiaggiaMiaOwnerGate = {
    isNative: isNative,
    enforceOwnerOnly: enforceOwnerOnly,
    isProprietario: isProprietario,
  };
})();
