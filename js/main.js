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
  const { data: { session } } = await sb.auth.getSession();
  if (session && !isPasswordRecovery) {
    currentUser = session.user;
    await loadUserAndRoute();
  }
  hideLoading();
});
