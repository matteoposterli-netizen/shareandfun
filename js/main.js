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
  if (params.get('admin') === '1') {
    await initAdminMode();
    hideLoading();
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
    const emailInput = document.getElementById('login-email');
    if (emailInput && loginEmail) emailInput.value = loginEmail;
    window.history.replaceState({}, '', window.location.pathname);
    showView('auth', 'login');
    const pwd = document.getElementById('login-password');
    if (pwd) pwd.focus();
    hideLoading();
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session && !isPasswordRecovery) {
    currentUser = session.user;
    await loadUserAndRoute();
  }
  enhanceDateInputs();
  hideLoading();
});
