window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('invito');
  if (token) {
    currentInviteToken = token;
    await showInvitoView(token);
    hideLoading();
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadUserAndRoute();
  }
  hideLoading();
});
