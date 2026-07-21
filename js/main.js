let isPasswordRecovery = false;

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    isPasswordRecovery = true;
    showView('auth', 'reset');
    hideLoading();
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  // Impersonazione admin: il magic link generato da admin-impersona-proprietario
  // reindirizza a /index.html?impersonated=1. Segna il flag (sessionStorage,
  // isolato per singola scheda) e ripulisci il query param preservando l'hash
  // (che contiene i token della sessione magic link letti da supabase-js).
  if (params.get('impersonated') === '1') {
    sessionStorage.setItem('sm_admin_impersonation', JSON.stringify({ active: true }));
    params.delete('impersonated');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + (window.location.hash || ''));
  }
  // Verifica email proprietario: il magic link generato da invia-verifica-email
  // reindirizza a /?verifica_email=1 (con i token di sessione nell'hash, letti
  // da supabase-js). Segniamo un flag, ripuliamo il query param preservando
  // l'hash, e più sotto — una volta stabilita la sessione — chiamiamo la RPC
  // conferma_email_proprietario() prima del normale routing.
  let verificaEmailPending = false;
  if (params.get('verifica_email') === '1') {
    verificaEmailPending = true;
    params.delete('verifica_email');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + (window.location.hash || ''));
  }
  if (params.get('admin') === '1') {
    // La modalità admin è ora una pagina dedicata (admin.html); ?admin=1 resta
    // solo come redirect legacy.
    window.location.replace('/admin.html');
    return;
  }
  const token = params.get('invito');
  if (token) {
    currentInviteToken = token;
    await showInvitoView(token);
    hideLoading();
    return;
  }
  const hash = window.location.hash || '';
  const isRecoveryUrl = params.get('reset') === '1' || hash.includes('type=recovery');
  if (isRecoveryUrl) {
    isPasswordRecovery = true;
    showView('auth', 'reset');
    hideLoading();
    return;
  }
  const loginEmail = params.get('login');
  if (loginEmail !== null) {
    await sb.auth.signOut();
    currentUser = null; currentProfile = null; currentStabilimento = null;
    updateNav();
    const emailInput = document.getElementById('login-identifier');
    if (emailInput && loginEmail) emailInput.value = loginEmail;
    window.history.replaceState({}, '', window.location.pathname);
    showView('auth', 'login');
    const pwd = document.getElementById('login-password');
    if (pwd) pwd.focus();
    hideLoading();
    return;
  }
  // MOBILE (no-op sul web): tentativo di sblocco biometrico all'avvio.
  // Se la biometria "possiede" l'avvio (utente arruolato), gestisce lei il
  // ripristino sessione + routing e interrompiamo qui il flusso standard.
  if (window.SpiaggiaMiaMobile && typeof window.SpiaggiaMiaMobile.tryBiometricUnlock === 'function') {
    const handled = await window.SpiaggiaMiaMobile.tryBiometricUnlock();
    if (handled) { enhanceDateInputs(); hideLoading(); return; }
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session && !isPasswordRecovery) {
    currentUser = session.user;
    // Se veniamo dal link di conferma email, marca l'email come verificata
    // PRIMA del routing, così loadUserAndRoute non ricade sul gate.
    if (verificaEmailPending) {
      try { await sb.rpc('conferma_email_proprietario'); }
      catch (e) { console.warn('conferma_email_proprietario RPC failed', e); }
    }
    await loadUserAndRoute();
    // Banner impersonazione: solo se il flag è presente E la sessione si è
    // stabilita correttamente (currentUser valorizzato dopo il routing).
    maybeShowImpersonationBanner();
  }
  enhanceDateInputs();
  hideLoading();
});

// Mostra un banner fisso quando la scheda è in modalità impersonazione admin.
// Legge il flag sessionStorage 'sm_admin_impersonation' e arricchisce con
// nome/email del proprietario da currentProfile/currentStabilimento/currentUser.
function maybeShowImpersonationBanner() {
  const raw = sessionStorage.getItem('sm_admin_impersonation');
  if (!raw) return;
  if (!currentUser) return;
  const nomeProprietario = currentProfile
    ? `${currentProfile.nome || ''} ${currentProfile.cognome || ''}`.trim()
    : '';
  const info = {
    active: true,
    nome: nomeProprietario,
    stabilimento: currentStabilimento?.nome || '',
    email: currentUser?.email || '',
  };
  sessionStorage.setItem('sm_admin_impersonation', JSON.stringify(info));
  renderImpersonationBanner(info);
}

function renderImpersonationBanner(info) {
  if (document.getElementById('impersonation-banner')) return;
  const chi = info.nome || info.email || 'il proprietario';
  const stab = info.stabilimento ? ` · ${info.stabilimento}` : '';
  const banner = document.createElement('div');
  banner.id = 'impersonation-banner';
  banner.innerHTML =
    `<span class="imp-banner-text">🔐 Modalità admin — stai operando come <strong>${chi}</strong>${stab}</span>` +
    `<button type="button" class="imp-banner-btn" onclick="exitImpersonation()">Esci da questa sessione</button>`;
  document.body.appendChild(banner);
  document.body.classList.add('has-impersonation-banner');
}

async function exitImpersonation() {
  sessionStorage.removeItem('sm_admin_impersonation');
  try { await sb.auth.signOut(); } catch (e) { /* no-op */ }
  const banner = document.getElementById('impersonation-banner');
  if (banner) banner.remove();
  document.body.classList.remove('has-impersonation-banner');
  // Prova a chiudere la scheda (funziona solo se aperta da script). Fallback:
  // messaggio esplicito, dato che il browser può rifiutare window.close() su
  // schede aperte manualmente dall'utente.
  window.close();
  setTimeout(() => {
    if (!window.closed) {
      document.body.innerHTML =
        '<div style="max-width:480px;margin:60px auto;padding:24px;text-align:center;' +
        'font-family:\'DM Sans\',sans-serif;color:#1e293b;">' +
        '<h2 style="margin-bottom:12px;">Sessione terminata</h2>' +
        '<p>Sei uscito dalla sessione impersonata. Puoi chiudere questa scheda.</p></div>';
    }
  }, 300);
}
