/*
 * owner-gate.js — Gate "app riservata ai gestori" per il wrapper Capacitor (Android).
 *
 * Caricato da index.html con un <script> classico (NIENTE bundler). È un
 * NO-OP completo sul web: tutti i percorsi sono guardati da `isNative()`
 * (window.Capacitor?.isNativePlatform?.()), quindi il deploy Vercel NON cambia
 * comportamento — sul sito gli stagionali continuano a usare la SPA normalmente.
 *
 * Sul device nativo applica la regola "copri prima, svela dopo": PRIMA che il
 * router (`loadUserAndRoute`) disegni qualunque vista mostra una COVER
 * full-screen a tutto schermo (stato "loading" = schermata di caricamento
 * brandizzata, identica allo splash dell'app); DOPO che il router ha risolto lo
 * stato, decide:
 *   - proprietario          → hideCover()  (svela la dashboard);
 *   - non proprietario      → showGate()   (messaggio "App riservata ai gestori");
 *   - non autenticato/ignoto → hideCover() (svela il login).
 * In questo modo la vista stagionale non compare MAI, né in ingresso (login)
 * né in uscita (logout).
 *
 * Aggancio: wrappa `window.loadUserAndRoute` (js/router.js), il punto in cui
 * TUTTI i flussi di auth confluiscono — showCover() PRIMA dell'originale,
 * decisione (hideCover/showGate) DOPO. Come fallback wrappa anche `doLogin` e
 * `completeInviteRegistration` (js/auth.js), che internamente chiamano comunque
 * loadUserAndRoute → la logica è idempotente.
 *
 * NB `doLogout` (js/auth.js) NON passa da loadUserAndRoute (fa direttamente
 * showView('landing')): il pulsante "Esci" riporta quindi la cover allo stato
 * loading e dopo `await doLogout()` chiama esplicitamente hideCover() come
 * fallback, così la vista stagionale non resta mai scoperta.
 *
 * Determinazione del ruolo: preferisce il global `currentProfile.ruolo` già
 * calcolato dal router (js/state.js → `let currentProfile`, popolato da
 * loadUserAndRoute). Se non disponibile, esegue una query diretta su `profiles`
 * (colonna `ruolo` ∈ {'proprietario','stagionale'}, PK `id` = auth.users.id).
 *
 * Lo spinner e il markup della cover "loading" riusano la stessa classe `.spinner`
 * di styles.css (animazione `spin`) e il colore di sfondo dello splash nativo
 * (#1B6CA8, vedi mobile/capacitor.config.json → SplashScreen.backgroundColor),
 * così la schermata è coerente con i caricamenti che l'app mostra già.
 *
 * Dipendenze a runtime già definite quando questo file viene eseguito:
 *   - `sb` (client Supabase, js/state.js)
 *   - `currentUser`, `currentProfile` (js/state.js, bare global lexical)
 *   - `loadUserAndRoute` (js/router.js), `doLogin`, `doLogout`,
 *     `completeInviteRegistration` (js/auth.js)
 */
(function () {
  'use strict';

  var COVER_ID = 'sm-owner-gate-overlay';
  // Colore di sfondo dello splash nativo (mobile/capacitor.config.json).
  var SPLASH_BG = '#1B6CA8';
  var FONT_STACK = '"DM Sans",system-ui,sans-serif';

  function isNative() {
    try {
      return !!(window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }

  // ---- COVER FULL-SCREEN (riutilizzata, due stati: loading / gate) ----------
  // Restituisce l'elemento cover (creandolo e appendendolo al body se manca).
  function ensureCover() {
    var el = document.getElementById(COVER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = COVER_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:' + SPLASH_BG, 'color:#fff',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'text-align:center', 'padding:32px',
      'font-family:' + FONT_STACK
    ].join(';');
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  // Stato "loading": schermata di caricamento brandizzata (riusa .spinner).
  function renderLoading(el) {
    if (el.getAttribute('data-state') === 'loading') return; // idempotente
    el.setAttribute('data-state', 'loading');
    el.innerHTML = '';

    var spinner = document.createElement('div');
    spinner.className = 'spinner';
    // Override colori per contrasto sul fondo blu (la classe fornisce shape +
    // animazione `spin`; qui rendiamo il bordo bianco).
    spinner.style.cssText = [
      'width:34px', 'height:34px', 'border-width:3px',
      'border-color:rgba(255,255,255,0.35)', 'border-top-color:#fff',
      'margin-bottom:18px'
    ].join(';');

    var label = document.createElement('div');
    label.textContent = 'Caricamento in corso…';
    label.style.cssText = 'font-size:16px;font-weight:500;opacity:.95';

    el.appendChild(spinner);
    el.appendChild(label);
  }

  // Stato "gate": messaggio "App riservata ai gestori" + pulsante "Esci".
  function renderGate(el) {
    if (el.getAttribute('data-state') === 'gate') return; // idempotente
    el.setAttribute('data-state', 'gate');
    el.innerHTML = '';

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
    btn.addEventListener('click', onEsci);

    el.appendChild(icon);
    el.appendChild(title);
    el.appendChild(msg);
    el.appendChild(btn);
  }

  // "Esci" senza lampo: NON scopre la vista → riporta la cover allo stato
  // loading, poi esegue il logout. doLogout non passa da loadUserAndRoute,
  // quindi hideCover() esplicito a fine logout (fallback).
  async function onEsci() {
    showCover();
    try {
      if (typeof window.doLogout === 'function') {
        await window.doLogout();
      }
    } catch (e) {
      console.warn('[owner-gate] doLogout', e);
    } finally {
      hideCover();
    }
  }

  function showCover() { renderLoading(ensureCover()); }   // stato loading
  function showGate() { renderGate(ensureCover()); }       // stato gate
  function hideCover() {
    var el = document.getElementById(COVER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---- RISOLUZIONE RUOLO ----------------------------------------------------
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

  // Applica il gate dopo che il router ha disegnato/risolto lo stato.
  // proprietario → svela; ruolo noto non proprietario → gate; ignoto → svela.
  async function enforceOwnerOnly() {
    if (!isNative()) { hideCover(); return; }
    var role = await resolveRole();
    if (role === 'proprietario') { hideCover(); return; } // proprietario → dashboard
    if (!role) { hideCover(); return; }                   // non autenticato → login
    showGate();                                           // stagionale/altro → blocco
  }

  // ---- AGGANCI AL FLUSSO ESISTENTE ----------------------------------------
  // Wrappa loadUserAndRoute: copre PRIMA (sincrono), decide DOPO.
  function wrapLoadUserAndRoute() {
    var orig = window.loadUserAndRoute;
    if (typeof orig !== 'function') return;
    window.loadUserAndRoute = async function () {
      showCover(); // copri prima che il router disegni qualunque vista
      var r = await orig.apply(this, arguments);
      try { await enforceOwnerOnly(); } catch (e) { console.warn('[owner-gate] post-hook loadUserAndRoute', e); }
      return r;
    };
  }

  // Fallback (idempotente): questi chiamano comunque loadUserAndRoute, ma li
  // wrappiamo per coprire anche eventuali percorsi che non vi confluiscono.
  function wrapAfter(name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = async function () {
      showCover();
      var r = await orig.apply(this, arguments);
      try { await enforceOwnerOnly(); } catch (e) { console.warn('[owner-gate] post-hook ' + name, e); }
      return r;
    };
  }

  // Intercetta SINCRONAMENTE showView: è il fix vero contro il lampo. Quando
  // loadUserAndRoute sta per disegnare la vista 'stagionale', `currentProfile`
  // è GIÀ impostato (js/state.js), quindi possiamo decidere senza affidarci al
  // paint. Per un non proprietario NON attiviamo mai #view-stagionale: mostriamo
  // direttamente il gate. La home stagionale non diventa così MAI visibile.
  function wrapShowView() {
    var orig = window.showView;
    if (typeof orig !== 'function') return;
    window.showView = function (viewId, sub) {
      if (isNative() && viewId === 'stagionale') {
        var ruolo = (typeof currentProfile !== 'undefined' && currentProfile)
                      ? currentProfile.ruolo : null;
        if (ruolo !== 'proprietario') {
          // Non proprietario: NON mostrare la home stagionale, mostra il gate.
          showGate();
          return;            // la vista stagionale non viene MAI attivata
        }
      }
      return orig.apply(this, arguments);
    };
  }

  if (isNative()) {
    wrapShowView();
    wrapLoadUserAndRoute();
    wrapAfter('doLogin');
    wrapAfter('completeInviteRegistration');
  }

  // Esposizione secondo convenzione window.*
  window.SpiaggiaMiaOwnerGate = {
    isNative: isNative,
    enforceOwnerOnly: enforceOwnerOnly,
    isProprietario: isProprietario,
    showCover: showCover,
    showGate: showGate,
    hideCover: hideCover,
  };
})();
